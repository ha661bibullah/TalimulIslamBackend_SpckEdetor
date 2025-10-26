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
  cors: {
    origin: "*",
  },
})

// ═══════════════════════════════════════════════════════
// 📧 GMAIL CONFIGURATION - উন্নত Nodemailer সেটআপ
// ═══════════════════════════════════════════════════════

let emailTransporter = null

function createEmailTransporter() {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      tls: {
        rejectUnauthorized: false,
      },
    })

    console.log("✅ Email transporter created successfully")
    console.log(`📧 Email configured for: ${process.env.EMAIL_USER}`)
    
    return transporter
  } catch (error) {
    console.error("❌ Error creating email transporter:", error)
    return null
  }
}

async function verifyEmailConnection() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error("⚠️  EMAIL_USER or EMAIL_PASS not configured in .env file")
    return false
  }

  try {
    if (!emailTransporter) {
      emailTransporter = createEmailTransporter()
    }
    
    await emailTransporter.verify()
    console.log("✅ Gmail SMTP connection verified successfully")
    return true
  } catch (error) {
    console.error("❌ Gmail SMTP connection failed:", error.message)
    console.error("\n🔧 সমস্যা সমাধান:")
    console.error("1. Gmail App Password সঠিকভাবে তৈরি করেছেন কিনা চেক করুন")
    console.error("2. .env ফাইলে EMAIL_USER এবং EMAIL_PASS সঠিকভাবে সেট করেছেন কিনা দেখুন")
    console.error("3. GMAIL_SETUP_GUIDE.md ফাইল দেখুন বিস্তারিত নির্দেশনার জন্য\n")
    return false
  }
}

// ═══════════════════════════════════════════════════════
// 🗄️ MongoDB Connection
// ═══════════════════════════════════════════════════════

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err))

// ═══════════════════════════════════════════════════════
// 📊 Models
// ═══════════════════════════════════════════════════════

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
  }),
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
  }),
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
  }),
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
  }),
)

// ═══════════════════════════════════════════════════════
// 🔧 Middleware
// ═══════════════════════════════════════════════════════

app.use(cors())
app.use(express.json())

const validatePayment = (req, res, next) => {
  const { name, email, phone, courseId, paymentMethod, txnId, amount } = req.body

  if (!name || !email || !phone || !courseId || !paymentMethod || !txnId || !amount) {
    return res.status(400).json({ message: "সমস্ত প্রয়োজনীয় ফিল্ড পূরণ করুন" })
  }

  if (!["bkash", "nagad", "bank", "card"].includes(paymentMethod)) {
    return res.status(400).json({ message: "অবৈধ পেমেন্ট মাধ্যম" })
  }

  next()
}

// ═══════════════════════════════════════════════════════
// 📧 Email Sending Helper Functions
// ═══════════════════════════════════════════════════════

async function sendEmail(to, subject, html) {
  try {
    if (!emailTransporter) {
      emailTransporter = createEmailTransporter()
    }

    const mailOptions = {
      from: `"তালিমুল ইসলাম একাডেমি" <${process.env.EMAIL_USER}>`,
      to: to,
      subject: subject,
      html: html,
    }

    console.log(`📤 Sending email to: ${to}`)
    console.log(`📝 Subject: ${subject}`)
    
    const info = await emailTransporter.sendMail(mailOptions)
    
    console.log(`✅ Email sent successfully to ${to}`)
    console.log(`📬 Message ID: ${info.messageId}`)
    
    return { success: true, messageId: info.messageId }
  } catch (error) {
    console.error(`❌ Failed to send email to ${to}:`, error.message)
    
    if (error.code === 'EAUTH') {
      console.error("\n🔐 Authentication Error:")
      console.error("• Gmail App Password ভুল হতে পারে")
      console.error("• GMAIL_SETUP_GUIDE.md দেখুন সঠিক পদ্ধতির জন্য\n")
    } else if (error.code === 'ECONNECTION') {
      console.error("\n🌐 Connection Error:")
      console.error("• ইন্টারনেট কানেকশন চেক করুন")
      console.error("• Gmail SMTP blocked হতে পারে\n")
    }
    
    throw error
  }
}

function generateOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString()
}

function getOTPEmailTemplate(otp, purpose = "registration") {
  const titles = {
    registration: "রেজিস্ট্রেশন OTP",
    reset: "পাসওয়ার্ড রিসেট OTP",
  }

  return `
    <!DOCTYPE html>
    <html lang="bn">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;600;700&display=swap');
        body { font-family: 'Hind Siliguri', Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4; }
      </style>
    </head>
    <body>
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f4f4f4; padding: 40px 0;">
        <tr>
          <td align="center">
            <table cellpadding="0" cellspacing="0" border="0" width="600" style="background-color: #ffffff; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
              
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #2E7D32 0%, #4CAF50 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                  <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">তালিমুল ইসলাম একাডেমি</h1>
                  <p style="color: #E8F5E9; margin: 10px 0 0 0; font-size: 14px;">অনলাইন ইসলামিক শিক্ষা প্ল্যাটফর্ম</p>
                </td>
              </tr>
              
              <!-- Content -->
              <tr>
                <td style="padding: 40px 30px;">
                  <h2 style="color: #2E7D32; text-align: center; margin: 0 0 20px 0; font-size: 24px;">${titles[purpose]}</h2>
                  
                  <p style="color: #555; font-size: 16px; line-height: 1.6; text-align: center; margin: 0 0 30px 0;">
                    আসসালামু আলাইকুম! আপনার ${purpose === "registration" ? "রেজিস্ট্রেশন" : "পাসওয়ার্ড রিসেট"} সম্পূর্ণ করতে নিচের OTP কোডটি ব্যবহার করুন:
                  </p>
                  
                  <!-- OTP Box -->
                  <table cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td align="center">
                        <div style="background: linear-gradient(135deg, #E8F5E9 0%, #C8E6C9 100%); padding: 25px; border-radius: 10px; border: 2px dashed #4CAF50; display: inline-block;">
                          <p style="margin: 0 0 10px 0; color: #2E7D32; font-size: 14px; font-weight: 600;">আপনার OTP কোড</p>
                          <div style="background: #ffffff; padding: 20px 40px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                            <span style="font-size: 36px; font-weight: 700; color: #2E7D32; letter-spacing: 8px; font-family: 'Courier New', monospace;">${otp}</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  </table>
                  
                  <!-- Warning -->
                  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top: 30px;">
                    <tr>
                      <td style="background: #FFF3E0; padding: 20px; border-radius: 8px; border-left: 4px solid #FF9800;">
                        <p style="margin: 0; color: #E65100; font-size: 14px; line-height: 1.6;">
                          <strong>⏰ গুরুত্বপূর্ণ:</strong> এই OTP কোডটি <strong>৫ মিনিটের</strong> জন্য বৈধ। এই কোড কারও সাথে শেয়ার করবেন না।
                        </p>
                      </td>
                    </tr>
                  </table>
                  
                  <!-- Help Text -->
                  <p style="color: #777; font-size: 13px; text-align: center; margin: 30px 0 0 0; line-height: 1.6;">
                    আপনি যদি এই OTP এর জন্য অনুরোধ না করে থাকেন, তাহলে এই ইমেইলটি উপেক্ষা করুন।
                  </p>
                </td>
              </tr>
              
              <!-- Footer -->
              <tr>
                <td style="background: #F5F5F5; padding: 25px 30px; text-align: center; border-radius: 0 0 10px 10px; border-top: 1px solid #E0E0E0;">
                  <p style="margin: 0 0 10px 0; color: #555; font-size: 14px; font-weight: 600;">
                    ধন্যবাদ ও শুভকামনা রইল
                  </p>
                  <p style="margin: 0; color: #2E7D32; font-size: 15px; font-weight: 700;">
                    তালিমুল ইসলাম একাডেমি টিম
                  </p>
                  <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #E0E0E0;">
                    <p style="margin: 0; color: #999; font-size: 12px;">
                      © 2025 তালিমুল ইসলাম একাডেমি। সর্বস্বত্ব সংরক্ষিত।
                    </p>
                  </div>
                </td>
              </tr>
              
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `
}

// ═══════════════════════════════════════════════════════
// 🔐 OTP Routes - রেজিস্ট্রেশন
// ═══════════════════════════════════════════════════════

app.post("/api/send-otp", async (req, res) => {
  try {
    const { email } = req.body

    if (!email) {
      return res.status(400).json({ success: false, message: "ইমেইল প্রয়োজন" })
    }

    const otp = generateOTP()
    console.log(`\n🔐 Generating OTP for registration: ${email}`)
    console.log(`🔑 OTP Code: ${otp}`)

    const emailHtml = getOTPEmailTemplate(otp, "registration")
    await sendEmail(email, "তালিমুল ইসলাম একাডেমি - রেজিস্ট্রেশন OTP", emailHtml)

    const user = await User.findOne({ email })
    if (user) {
      user.otp = otp
      user.otpExpires = Date.now() + 300000
      await user.save()
      console.log(`💾 OTP saved to existing user: ${email}`)
    } else {
      global.tempOTPs = global.tempOTPs || {}
      global.tempOTPs[email] = {
        otp,
        expires: Date.now() + 300000,
      }
      console.log(`💾 OTP saved to temporary storage: ${email}`)
    }

    res.json({ success: true, message: "OTP সফলভাবে পাঠানো হয়েছে" })
  } catch (error) {
    console.error("❌ Error sending OTP:", error)
    res.status(500).json({ 
      success: false, 
      message: "OTP পাঠাতে সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    })
  }
})

app.post("/api/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body

    console.log(`\n🔍 Verifying OTP for: ${email}`)

    if (global.tempOTPs && global.tempOTPs[email]) {
      const tempOTP = global.tempOTPs[email]
      if (tempOTP.otp === otp && tempOTP.expires > Date.now()) {
        delete global.tempOTPs[email]
        console.log(`✅ OTP verified from temporary storage: ${email}`)
        return res.json({ success: true })
      }
      console.log(`❌ Invalid or expired OTP from temporary storage: ${email}`)
      return res.status(400).json({
        success: false,
        message: "ভুল OTP অথবা মেয়াদ শেষ",
      })
    }

    const user = await User.findOne({ email })
    if (!user || !user.otp) {
      console.log(`❌ OTP not found for user: ${email}`)
      return res.status(400).json({
        success: false,
        message: "OTP পাওয়া যায়নি অথবা মেয়াদ শেষ",
      })
    }

    if (user.otp !== otp) {
      console.log(`❌ OTP mismatch for user: ${email}`)
      return res.status(400).json({
        success: false,
        message: "ভুল OTP",
      })
    }

    if (user.otpExpires < Date.now()) {
      console.log(`❌ OTP expired for user: ${email}`)
      return res.status(400).json({
        success: false,
        message: "OTP এর মেয়াদ শেষ",
      })
    }

    user.otp = undefined
    user.otpExpires = undefined
    await user.save()

    console.log(`✅ OTP verified successfully: ${email}`)
    res.json({ success: true })
  } catch (error) {
    console.error("❌ Error verifying OTP:", error)
    res.status(500).json({
      success: false,
      message: "OTP যাচাই করতে সমস্যা",
    })
  }
})

// ═══════════════════════════════════════════════════════
// 🔄 Password Reset Routes
// ═══════════════════════════════════════════════════════

app.post("/api/forgot-password", async (req, res) => {
  try {
    const { email } = req.body

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({ success: false, message: "এই ইমেইলটি রেজিস্টার্ড নয়" })
    }

    const otp = generateOTP()
    console.log(`\n🔐 Password reset OTP for: ${email}`)
    console.log(`🔑 OTP Code: ${otp}`)

    const emailHtml = getOTPEmailTemplate(otp, "reset")
    await sendEmail(email, "তালিমুল ইসলাম একাডেমি - পাসওয়ার্ড রিসেট OTP", emailHtml)

    user.otp = otp
    user.otpExpires = Date.now() + 300000
    await user.save()

    console.log(`✅ Password reset OTP sent to: ${email}`)
    res.json({ success: true, message: "OTP সফলভাবে পাঠানো হয়েছে" })
  } catch (error) {
    console.error("❌ Error in forgot password:", error)
    res.status(500).json({ success: false, message: "পাসওয়ার্ড রিসেট করতে সমস্যা হয়েছে" })
  }
})

app.post("/api/verify-reset-otp", async (req, res) => {
  try {
    const { email, otp } = req.body

    console.log(`\n🔍 Verifying reset OTP for: ${email}`)

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "ব্যবহারকারী পাওয়া যায়নি",
      })
    }

    if (!user.otp || user.otp !== otp || user.otpExpires < Date.now()) {
      console.log(`❌ OTP verification failed for: ${email}`)
      return res.status(400).json({
        success: false,
        message: "অবৈধ OTP অথবা OTP এর মেয়াদ শেষ",
      })
    }

    console.log(`✅ Reset OTP verified successfully: ${email}`)
    res.json({
      success: true,
      message: "OTP সঠিকভাবে যাচাই হয়েছে",
    })
  } catch (error) {
    console.error("❌ OTP verification error:", error)
    res.status(500).json({
      success: false,
      message: "OTP যাচাই করতে সমস্যা হয়েছে",
    })
  }
})

app.post("/api/reset-password", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "সমস্ত প্রয়োজনীয় ফিল্ড পূরণ করুন",
      })
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে",
      })
    }

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "ব্যবহারকারী পাওয়া যায়নি",
      })
    }

    if (!user.otp || user.otp !== otp || user.otpExpires < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "অবৈধ OTP অথবা OTP এর মেয়াদ শেষ",
      })
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10)

    const updateResult = await User.findOneAndUpdate(
      { email: email },
      {
        $set: { password: hashedPassword },
        $unset: { otp: "", otpExpires: "" },
      },
      { new: true },
    )

    if (!updateResult) {
      return res.status(500).json({
        success: false,
        message: "পাসওয়ার্ড আপডেট করতে সমস্যা হয়েছে",
      })
    }

    console.log(`✅ Password successfully reset for: ${email}`)

    res.json({
      success: true,
      message: "পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে। এখন নতুন পাসওয়ার্ড দিয়ে লগইন করুন।",
    })
  } catch (error) {
    console.error("❌ Password reset error:", error)
    res.status(500).json({
      success: false,
      message: "পাসওয়ার্ড রিসেট করতে সমস্যা হয়েছে",
    })
  }
})

// ═══════════════════════════════════════════════════════
// 📚 Other Routes (User, Payment, Course, Review)
// ═══════════════════════════════════════════════════════

app.get("/api/users/:email/courses", async (req, res) => {
  try {
    const user = await User.findOne({ email: req.params.email })
    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }
    res.json({ courses: user.courses || [] })
  } catch (error) {
    console.error("Error fetching user courses:", error)
    res.status(500).json({ message: "Error fetching user courses" })
  }
})

app.post("/api/payments", validatePayment, async (req, res) => {
  try {
    const payment = new Payment(req.body)
    await payment.save()
    res.status(201).json(payment)
  } catch (error) {
    console.error("Error saving payment:", error)
    res.status(500).json({ message: "পেমেন্ট সেভ করতে সমস্যা হয়েছে" })
  }
})

app.get("/api/admin/payments", async (req, res) => {
  try {
    const { status, page = 1, limit = 10, search = "" } = req.query
    const query = {}
    if (status) query.status = status
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { txnId: { $regex: search, $options: "i" } },
      ]
    }
    const payments = await Payment.find(query)
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
    const count = await Payment.countDocuments(query)
    res.json({
      payments,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
    })
  } catch (error) {
    console.error("Error fetching payments:", error)
    res.status(500).json({ message: "পেমেন্ট লোড করতে সমস্যা হয়েছে" })
  }
})

app.get("/api/admin/payments/:id", async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id)
    if (!payment) {
      return res.status(404).json({ message: "পেমেন্ট পাওয়া যায়নি" })
    }
    res.json(payment)
  } catch (error) {
    console.error("Error fetching payment:", error)
    res.status(500).json({ message: "পেমেন্ট ডিটেইলস লোড করতে সমস্যা হয়েছে" })
  }
})

app.put("/api/admin/payments/:id", async (req, res) => {
  try {
    const { status } = req.body
    if (!status || !["approved", "rejected", "pending"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value",
      })
    }
    const payment = await Payment.findByIdAndUpdate(req.params.id, { status }, { new: true })
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      })
    }
    if (status === "approved") {
      await User.findOneAndUpdate(
        { email: payment.email },
        { $addToSet: { courses: payment.courseId } },
        { new: true, upsert: true },
      )
      io.emit("courseAccessUpdated", {
        type: "courseAccessUpdated",
        email: payment.email,
        courseId: payment.courseId,
        courseName: payment.courseName,
        paymentId: payment._id,
        userName: payment.name,
        timestamp: new Date().toISOString(),
      })
    }
    res.json({
      success: true,
      message: "Payment status updated successfully",
      payment,
    })
  } catch (error) {
    console.error("Error updating payment:", error)
    res.status(500).json({
      success: false,
      message: "Error updating payment",
    })
  }
})

app.get("/api/reviews/:courseId", async (req, res) => {
  try {
    const { courseId } = req.params
    const reviews = await Review.find({
      courseId,
      isApproved: true,
    }).sort({ date: -1 })
    res.json({ success: true, reviews })
  } catch (error) {
    console.error("Error fetching reviews:", error)
    res.status(500).json({ success: false, message: "রিভিউ লোড করতে সমস্যা হয়েছে" })
  }
})

app.post("/api/reviews", async (req, res) => {
  try {
    const { courseId, reviewerName, reviewerEmail, rating, reviewText } = req.body
    if (!courseId || !reviewerName || !reviewerEmail || !rating || !reviewText) {
      return res.status(400).json({
        success: false,
        message: "সমস্ত প্রয়োজনীয় ফিল্ড পূরণ করুন",
      })
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: "রেটিং ১ থেকে ৫ এর মধ্যে হতে হবে",
      })
    }
    const existingReview = await Review.findOne({ courseId, reviewerEmail })
    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: "আপনি ইতিমধ্যে এই কোর্সের রিভিউ দিয়েছেন",
      })
    }
    const review = new Review({
      courseId,
      reviewerName,
      reviewerEmail,
      rating: Number.parseInt(rating),
      reviewText,
    })
    await review.save()
    res.status(201).json({
      success: true,
      message: "রিভিউ সফলভাবে জমা দেওয়া হয়েছে",
      review,
    })
  } catch (error) {
    console.error("Error submitting review:", error)
    res.status(500).json({
      success: false,
      message: "রিভিউ জমা দিতে সমস্যা হয়েছে",
    })
  }
})

app.get("/api/admin/reviews", async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query
    const query = {}
    if (status === "pending") query.isApproved = false
    if (status === "approved") query.isApproved = true
    const reviews = await Review.find(query)
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
    const count = await Review.countDocuments(query)
    res.json({
      success: true,
      reviews,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
    })
  } catch (error) {
    console.error("Error fetching admin reviews:", error)
    res.status(500).json({ success: false, message: "রিভিউ লোড করতে সমস্যা হয়েছে" })
  }
})

app.put("/api/admin/reviews/:id", async (req, res) => {
  try {
    const { isApproved } = req.body
    const review = await Review.findByIdAndUpdate(req.params.id, { isApproved }, { new: true })
    if (!review) {
      return res.status(404).json({ success: false, message: "রিভিউ পাওয়া যায়নি" })
    }
    res.json({
      success: true,
      message: `রিভিউ ${isApproved ? "অনুমোদিত" : "প্রত্যাখ্যাত"} হয়েছে`,
      review,
    })
  } catch (error) {
    console.error("Error updating review:", error)
    res.status(500).json({ success: false, message: "রিভিউ আপডেট করতে সমস্যা হয়েছে" })
  }
})

// ═══════════════════════════════════════════════════════
// 🚀 Server Initialization
// ═══════════════════════════════════════════════════════

const PORT = process.env.PORT || 5000

server.listen(PORT, async () => {
  console.log("\n" + "═".repeat(60))
  console.log("🚀 তালিমুল ইসলাম একাডেমি - Backend Server")
  console.log("═".repeat(60))
  console.log(`✅ Server running on port ${PORT}`)
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`)
  console.log("═".repeat(60))
  
  await verifyEmailConnection()
  
  console.log("═".repeat(60) + "\n")
})
