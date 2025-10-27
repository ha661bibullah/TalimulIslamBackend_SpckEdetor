const express = require("express")
const mongoose = require("mongoose")
const nodemailer = require("nodemailer")
const cors = require("cors")
const dotenv = require("dotenv")
const http = require("http")
const { Server } = require("socket.io")
const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")

dotenv.config()
const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: "*" },
})

// Middleware
app.use(cors())
app.use(express.json())

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.error("MongoDB Connection Error:", err))

// ====== Models ======
const User = mongoose.model(
  "User",
  new mongoose.Schema({
    name: String,
    email: { type: String, unique: true },
    password: String,
    courses: [String],
    otp: String,
    otpExpires: Date,
    resetToken: String,
    resetTokenExpires: Date,
  })
)

const Payment = mongoose.model(
  "Payment",
  new mongoose.Schema({
    userId: String,
    name: String,
    email: String,
    phone: String,
    courseId: String,
    courseName: String,
    paymentMethod: String,
    txnId: String,
    amount: Number,
    status: { type: String, default: "pending" },
    date: { type: Date, default: Date.now },
  })
)

const Course = mongoose.model(
  "Course",
  new mongoose.Schema({
    id: String,
    title: String,
    description: String,
    price: Number,
    duration: String,
    instructor: String,
    createdAt: { type: Date, default: Date.now },
  })
)

const Review = mongoose.model(
  "Review",
  new mongoose.Schema({
    courseId: { type: String, required: true },
    reviewerName: { type: String, required: true },
    reviewerEmail: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    reviewText: { type: String, required: true },
    date: { type: Date, default: Date.now },
    isApproved: { type: Boolean, default: true },
  })
)

// ====== Nodemailer Transporter (pool + timeout) ======
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  pool: true,
  maxConnections: 5,
  rateDelta: 20000,
  rateLimit: 5,
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
})

// ====== OTP Routes ======
app.post("/api/send-otp", async (req, res) => {
  try {
    const { email } = req.body
    const otp = Math.floor(1000 + Math.random() * 9000).toString()

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "তালিমুল ইসলাম একাডেমি - OTP কোড",
      text: `আপনার OTP কোড: ${otp}`,
    }

    await transporter.sendMail(mailOptions)
    console.log(`OTP sent to ${email}: ${otp}`)

    const user = await User.findOne({ email })
    if (user) {
      user.otp = otp
      user.otpExpires = Date.now() + 600000 // 10 minutes
      await user.save()
    } else {
      global.tempOTPs = global.tempOTPs || {}
      global.tempOTPs[email] = { otp, expires: Date.now() + 600000 }
    }

    res.json({ success: true, message: "OTP সফলভাবে পাঠানো হয়েছে" })
  } catch (error) {
    console.error("Error sending OTP:", error)
    res.status(500).json({ success: false, message: "OTP পাঠাতে সমস্যা হয়েছে", error: error.message })
  }
})

app.post("/api/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body

    // Check temp OTP for new users
    if (global.tempOTPs && global.tempOTPs[email]) {
      const tempOTP = global.tempOTPs[email]
      if (tempOTP.otp === otp && tempOTP.expires > Date.now()) {
        delete global.tempOTPs[email]
        return res.json({ success: true })
      }
      return res.status(400).json({ success: false, message: "Invalid OTP or expired" })
    }

    const user = await User.findOne({ email })
    if (!user || !user.otp) return res.status(400).json({ success: false, message: "OTP not found or expired" })

    if (user.otp !== otp || user.otpExpires < Date.now()) {
      return res.status(400).json({ success: false, message: "OTP invalid or expired" })
    }

    // Clear OTP
    user.otp = undefined
    user.otpExpires = undefined
    await user.save()

    res.json({ success: true })
  } catch (error) {
    console.error("Error verifying OTP:", error)
    res.status(500).json({ success: false, message: "Error verifying OTP", error: error.message })
  }
})

// ====== Password Reset Routes ======
app.post("/api/forgot-password", async (req, res) => {
  try {
    const { email } = req.body
    const user = await User.findOne({ email })
    if (!user) return res.status(404).json({ success: false, message: "User not found" })

    const otp = Math.floor(1000 + Math.random() * 9000).toString()

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "পাসওয়ার্ড রিসেট OTP",
      html: `<p>আপনার OTP: <strong>${otp}</strong> (10 মিনিটের জন্য বৈধ)</p>`,
    })

    user.otp = otp
    user.otpExpires = Date.now() + 600000 // 10 minutes
    await user.save()

    res.json({ success: true, message: "OTP সফলভাবে পাঠানো হয়েছে" })
  } catch (error) {
    console.error("Error in forgot password:", error)
    res.status(500).json({ success: false, message: "OTP পাঠাতে সমস্যা হয়েছে", error: error.message })
  }
})

app.post("/api/reset-password", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body
    if (!email || !otp || !newPassword || newPassword.length < 6)
      return res.status(400).json({ success: false, message: "Invalid input or password too short" })

    const user = await User.findOne({ email })
    if (!user || !user.otp || user.otp !== otp || user.otpExpires < Date.now())
      return res.status(400).json({ success: false, message: "OTP invalid or expired" })

    const hashedPassword = await bcrypt.hash(newPassword, 10)
    user.password = hashedPassword
    user.otp = undefined
    user.otpExpires = undefined
    await user.save()

    res.json({ success: true, message: "Password successfully updated" })
  } catch (error) {
    console.error("Error resetting password:", error)
    res.status(500).json({ success: false, message: "Password reset failed", error: error.message })
  }
})

// ====== Registration & Login ======
app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password } = req.body
    const existingUser = await User.findOne({ email })
    if (existingUser) return res.status(400).json({ message: "User already exists" })

    const hashedPassword = await bcrypt.hash(password, 10)
    const user = await new User({ name, email, password: hashedPassword, courses: [] }).save()

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "1d" })
    res.status(201).json({ token, user: { id: user._id, name, email, courses: [] } })
  } catch (error) {
    console.error("Registration error:", error)
    res.status(500).json({ message: "Registration failed", error: error.message })
  }
})

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body
    const user = await User.findOne({ email })
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ message: "Invalid credentials" })

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "1d" })
    res.json({ token, user: { id: user._id, name: user.name, email, courses: user.courses } })
  } catch (error) {
    console.error("Login error:", error)
    res.status(500).json({ message: "Login failed", error: error.message })
  }
})

// ====== Courses & Reviews ======
app.get("/api/courses", async (req, res) => {
  try {
    const courses = await Course.find()
    res.json(courses)
  } catch (error) {
    console.error("Error fetching courses:", error)
    res.status(500).json({ message: "কোর্স লোড করতে সমস্যা হয়েছে" })
  }
})

app.get("/api/reviews/:courseId", async (req, res) => {
  try {
    const reviews = await Review.find({ courseId: req.params.courseId, isApproved: true }).sort({ date: -1 })
    res.json({ success: true, reviews })
  } catch (error) {
    console.error("Error fetching reviews:", error)
    res.status(500).json({ success: false, message: "রিভিউ লোড করতে সমস্যা হয়েছে", error: error.message })
  }
})

// ====== Payments ======
const validatePayment = (req, res, next) => {
  const { name, email, phone, courseId, paymentMethod, txnId, amount } = req.body
  if (!name || !email || !phone || !courseId || !paymentMethod || !txnId || !amount)
    return res.status(400).json({ message: "সমস্ত প্রয়োজনীয় ফিল্ড পূরণ করুন" })
  if (!["bkash", "nagad", "bank", "card"].includes(paymentMethod))
    return res.status(400).json({ message: "অবৈধ পেমেন্ট মাধ্যম" })
  next()
}

app.post("/api/payments", validatePayment, async (req, res) => {
  try {
    const payment = await new Payment(req.body).save()
    io.emit("newPayment", payment)
    res.status(201).json(payment)
  } catch (error) {
    console.error("Error saving payment:", error)
    res.status(500).json({ message: "পেমেন্ট সেভ করতে সমস্যা হয়েছে", error: error.message })
  }
})

// ====== WebSocket ======
io.on("connection", (socket) => {
  console.log("A user connected")
  socket.on("disconnect", () => console.log("A user disconnected"))
})

// ====== Fallback & Error Handling ======
app.use("*", (req, res) => res.status(404).json({ success: false, message: "API endpoint পাওয়া যায়নি", path: req.originalUrl }))

app.use((error, req, res, next) => {
  console.error("Global error handler:", error)
  res.status(500).json({
    success: false,
    message: "সার্ভার এরর হয়েছে",
    error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
  })
})

// ====== Start Server ======
const PORT = process.env.PORT || 5000
server.listen(PORT, () => console.log(`Server running on port ${PORT}`))