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

// MongoDB কানেকশন
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.error("MongoDB Connection Error:", err))

// মডেল ডিফাইন
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

// মিডলওয়্যার
app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Email Transporter কনফিগারেশন - CORRECTED
const createTransporter = () => {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    connectionTimeout: 30000,
    socketTimeout: 30000,
    greetingTimeout: 30000,
  })
}

// OTP সেন্ড এন্ডপয়েন্ট
app.post("/api/send-otp", async (req, res) => {
  try {
    if (!req.body || !req.body.email) {
      return res.status(400).json({
        success: false,
        message: "ইমেইল ঠিকানা প্রদান করুন",
      })
    }

    const { email } = req.body;
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "সঠিক ইমেইল ঠিকানা প্রদান করুন",
      })
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    
    console.log(`Attempting to send OTP to: ${email}`);
    
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.error("EMAIL_USER or EMAIL_PASS environment variables are missing");
      return res.status(500).json({
        success: false,
        message: "ইমেইল সার্ভিস কনফিগার করা নেই",
      });
    }

    const transporter = createTransporter();
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "তালিমুল ইসলাম একাডেমি - OTP কোড",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #4caf50; text-align: center;">OTP কোড</h2>
          <div style="background: #f8f9fa; padding: 20px; border-radius: 10px; text-align: center;">
            <p style="font-size: 16px; margin-bottom: 20px;">আপনার OTP কোড:</p>
            <div style="background: #fff; padding: 15px; border-radius: 5px; font-size: 24px; font-weight: bold; color: #333; letter-spacing: 5px; margin: 20px 0;">
              ${otp}
            </div>
            <p style="color: #666; font-size: 14px;">এই OTP কোডটি ৫ মিনিটের জন্য বৈধ।</p>
          </div>
          <p style="margin-top: 20px; color: #666; text-align: center;">
            ধন্যবাদ,<br>
            তালিমুল ইসলাম একাডেমি টিম
          </p>
        </div>
      `,
    };
    
    const emailPromise = transporter.sendMail(mailOptions);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Email sending timeout")), 25000);
    });

    await Promise.race([emailPromise, timeoutPromise]);
    
    console.log(`OTP sent successfully to: ${email}`);
    
    const user = await User.findOne({ email });
    if (user) {
      user.otp = otp;
      user.otpExpires = Date.now() + 300000;
      await user.save();
    } else {
      global.tempOTPs = global.tempOTPs || {};
      global.tempOTPs[email] = {
        otp,
        expires: Date.now() + 300000,
      };
    }

    res.json({ 
      success: true, 
      message: "OTP সফলভাবে পাঠানো হয়েছে" 
    });
    
  } catch (error) {
    console.error("Detailed OTP error:", error);
    
    let errorMessage = "OTP পাঠাতে সমস্যা হয়েছে";
    if (error.message.includes("timeout")) {
      errorMessage = "ইমেইল সার্ভারে সংযোগ করতে সময় লাগছে। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।";
    } else if (error.code === "EAUTH") {
      errorMessage = "ইমেইল লগইন ক্রেডেনশিয়াল সমস্যা। অ্যাডমিনকে জানান।";
    } else if (error.message.includes("createTransporter")) {
      errorMessage = "ইমেইল সার্ভিস কনফিগারেশন সমস্যা। অ্যাডমিনকে জানান।";
    }

    res.status(500).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

// Password reset routes
app.post("/api/forgot-password", async (req, res) => {
  try {
    if (!req.body || !req.body.email) {
      return res.status(400).json({ 
        success: false, 
        message: "ইমেইল ঠিকানা প্রদান করুন" 
      });
    }

    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: "এই ইমেইলটি রেজিস্টার্ড নয়" 
      });
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    const transporter = createTransporter();

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "তালিমুল ইসলাম একাডেমি - পাসওয়ার্ড রিসেট OTP",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #4caf50; text-align: center;">পাসওয়ার্ড রিসেট OTP</h2>
          <div style="background: #f8f9fa; padding: 20px; border-radius: 10px; text-align: center;">
            <p style="font-size: 16px; margin-bottom: 20px;">আপনার পাসওয়ার্ড রিসেট করার জন্য নিচের OTP কোডটি ব্যবহার করুন:</p>
            <div style="background: #fff; padding: 15px; border-radius: 5px; font-size: 24px; font-weight: bold; color: #333; letter-spacing: 5px; margin: 20px 0;">
              ${otp}
            </div>
            <p style="color: #666; font-size: 14px;">এই OTP কোডটি ৫ মিনিটের জন্য বৈধ।</p>
          </div>
          <p style="margin-top: 20px; color: #666; text-align: center;">
            ধন্যবাদ,<br>
            তালিমুল ইসলাম একাডেমি টিম
          </p>
        </div>
      `,
    };

    const emailPromise = transporter.sendMail(mailOptions);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Email sending timeout")), 25000);
    });

    await Promise.race([emailPromise, timeoutPromise]);

    user.otp = otp;
    user.otpExpires = Date.now() + 300000;
    await user.save();

    console.log(`Password reset OTP sent to ${email}: ${otp}`);

    res.json({ 
      success: true, 
      message: "OTP সফলভাবে পাঠানো হয়েছে" 
    });
  } catch (error) {
    console.error("Error in forgot password:", error);
    
    let errorMessage = "পাসওয়ার্ড রিসেট করতে সমস্যা হয়েছে";
    if (error.message.includes("timeout")) {
      errorMessage = "ইমেইল সার্ভারে সংযোগ করতে সময় লাগছে। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।";
    } else if (error.message.includes("createTransporter")) {
      errorMessage = "ইমেইল সার্ভিস কনফিগারেশন সমস্যা। অ্যাডমিনকে জানান।";
    }

    res.status(500).json({ 
      success: false, 
      message: errorMessage,
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

// পাসওয়ার্ড রিসেটের জন্য OTP যাচাইকরণ
app.post("/api/verify-reset-otp", async (req, res) => {
  try {
    if (!req.body || !req.body.email || !req.body.otp) {
      return res.status(400).json({
        success: false,
        message: "ইমেইল এবং OTP প্রদান করুন",
      });
    }

    const { email, otp } = req.body;

    console.log(`Verifying reset OTP for ${email}: ${otp}`);

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "ব্যবহারকারী পাওয়া যায়নি",
      });
    }

    if (!user.otp || user.otp !== otp || user.otpExpires < Date.now()) {
      console.log(`OTP verification failed for ${email}`);
      return res.status(400).json({
        success: false,
        message: "অবৈধ OTP অথবা OTP এর মেয়াদ শেষ",
      });
    }

    console.log(`OTP verified successfully for ${email}`);
    
    res.json({
      success: true,
      message: "OTP সঠিকভাবে যাচাই হয়েছে",
    });
  } catch (error) {
    console.error("OTP যাচাই করতে সমস্যা:", error);
    res.status(500).json({
      success: false,
      message: "OTP যাচাই করতে সমস্যা হয়েছে",
    });
  }
});

// নতুন পাসওয়ার্ড সেট করার রাউট
app.post("/api/reset-password", async (req, res) => {
  try {
    if (!req.body || !req.body.email || !req.body.otp || !req.body.newPassword) {
      return res.status(400).json({
        success: false,
        message: "সমস্ত প্রয়োজনীয় ফিল্ড পূরণ করুন",
      });
    }

    const { email, otp, newPassword } = req.body;

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে",
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "ব্যবহারকারী পাওয়া যায়নি",
      });
    }

    if (!user.otp || user.otp !== otp || user.otpExpires < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "অবৈধ OTP অথবা OTP এর মেয়াদ শেষ",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    await User.findOneAndUpdate(
      { email: email },
      {
        $set: { password: hashedPassword },
        $unset: { otp: "", otpExpires: "" },
      }
    );

    res.json({
      success: true,
      message: "পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে",
    });
  } catch (error) {
    console.error("পাসওয়ার্ড রিসেট করতে সমস্যা:", error);
    res.status(500).json({
      success: false,
      message: "পাসওয়ার্ড রিসেট করতে সমস্যা হয়েছে",
    });
  }
});

// OTP যাচাইকরণ
app.post("/api/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "ইমেইল এবং OTP প্রদান করুন",
      })
    }

    if (global.tempOTPs && global.tempOTPs[email]) {
      const tempOTP = global.tempOTPs[email]
      if (tempOTP.otp === otp && tempOTP.expires > Date.now()) {
        delete global.tempOTPs[email]
        return res.json({ success: true })
      }
      return res.status(400).json({
        success: false,
        message: "Invalid OTP or expired",
      })
    }

    const user = await User.findOne({ email })
    if (!user || !user.otp) {
      return res.status(400).json({
        success: false,
        message: "OTP not found or expired",
      })
    }

    if (user.otp !== otp) {
      return res.status(400).json({
        success: false,
        message: "OTP doesn't match",
      })
    }

    if (user.otpExpires < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "OTP expired",
      })
    }

    user.otp = undefined
    user.otpExpires = undefined
    await user.save()

    res.json({ success: true })
  } catch (error) {
    console.error("Error verifying OTP:", error)
    res.status(500).json({
      success: false,
      message: "Error verifying OTP",
    })
  }
})

// পেমেন্ট ভ্যালিডেশন মিডলওয়্যার
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

// পেমেন্ট রাউটস
app.post("/api/payments", validatePayment, async (req, res) => {
  try {
    const payment = new Payment(req.body)
    await payment.save()

    await notifyAdmin(payment._id)

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

// পেমেন্ট আপডেট রাউট
app.put("/api/admin/payments/:id", async (req, res) => {
  try {
    const { status } = req.body

    if (!status || !["approved", "rejected", "pending"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value. Only approved, rejected or pending accepted",
      })
    }

    const payment = await Payment.findByIdAndUpdate(req.params.id, { status }, { new: true })

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      })
    }

    console.log(`Payment ${payment._id} status updated to: ${status}`)

    if (status === "approved") {
      const user = await User.findOneAndUpdate(
        { email: payment.email },
        { $addToSet: { courses: payment.courseId } },
        { new: true, upsert: true },
      )

      console.log(`User ${payment.email} granted access to course ${payment.courseId}`)

      const notification = {
        type: "courseAccessUpdated",
        email: payment.email,
        courseId: payment.courseId,
        courseName: payment.courseName,
        paymentId: payment._id,
        userName: payment.name,
        timestamp: new Date().toISOString(),
      }

      io.emit("courseAccessUpdated", notification)

      console.log("Course access notification broadcasted:", notification)

      try {
        await sendCourseAccessEmail(payment.email, payment.name, payment.courseName || payment.courseId)
      } catch (emailError) {
        console.error("Failed to send email notification:", emailError)
      }
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
      error: error.message,
    })
  }
})

// রিভিউ রাউটস
app.get("/api/reviews/:courseId", async (req, res) => {
  try {
    const { courseId } = req.params
    const reviews = await Review.find({
      courseId,
      isApproved: true,
    }).sort({ date: -1 })

    res.setHeader("Content-Type", "application/json")
    res.json({ success: true, reviews })
  } catch (error) {
    console.error("Error fetching reviews:", error)
    res.setHeader("Content-Type", "application/json")
    res.status(500).json({ success: false, message: "রিভিউ লোড করতে সমস্যা হয়েছে", error: error.message })
  }
})

app.post("/api/reviews", async (req, res) => {
  try {
    const { courseId, reviewerName, reviewerEmail, rating, reviewText } = req.body

    if (!courseId || !reviewerName || !reviewerEmail || !rating || !reviewText) {
      return res.status(400).json({
        success: false,
        message: "সমস্ত প্রয়োজনীয় ফিল্ড পূরণ করুন",
        missingFields: {
          courseId: !courseId,
          reviewerName: !reviewerName,
          reviewerEmail: !reviewerEmail,
          rating: !rating,
          reviewText: !reviewText,
        },
      })
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: "রেটিং ১ থেকে ৫ এর মধ্যে হতে হবে",
      })
    }

    const existingReview = await Review.findOne({
      courseId,
      reviewerEmail,
    })

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

    res.setHeader("Content-Type", "application/json")
    res.status(201).json({
      success: true,
      message: "রিভিউ সফলভাবে জমা দেওয়া হয়েছে। অনুমোদনের পর প্রকাশিত হবে।",
      review: {
        id: review._id,
        courseId: review.courseId,
        reviewerName: review.reviewerName,
        rating: review.rating,
        reviewText: review.reviewText,
        date: review.date,
      },
    })
  } catch (error) {
    console.error("Error submitting review:", error)
    res.setHeader("Content-Type", "application/json")
    res.status(500).json({
      success: false,
      message: "রিভিউ জমা দিতে সমস্যা হয়েছে",
      error: error.message,
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

// কোর্স রাউটস
app.get("/api/courses", async (req, res) => {
  try {
    const courses = await Course.find()
    res.json(courses)
  } catch (error) {
    console.error("Error fetching courses:", error)
    res.status(500).json({ message: "কোর্স লোড করতে সমস্যা হয়েছে" })
  }
})

// Authentication Routes
app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password } = req.body

    if (!name || !email || !password) {
      return res.status(400).json({ message: "সমস্ত প্রয়োজনীয় ফিল্ড পূরণ করুন" })
    }

    const existingUser = await User.findOne({ email })
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const user = new User({
      name,
      email,
      password: hashedPassword,
      courses: [],
    })

    await user.save()

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "1d" })

    res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        courses: user.courses,
      },
    })
  } catch (error) {
    console.error("Registration error:", error)
    res.status(500).json({ message: "Registration failed" })
  }
})

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ message: "ইমেইল এবং পাসওয়ার্ড প্রদান করুন" })
    }

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" })
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" })
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "1d" })

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        courses: user.courses,
      },
    })
  } catch (error) {
    console.error("Login error:", error)
    res.status(500).json({ message: "Login failed" })
  }
})

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

// হেল্পার ফাংশন
async function notifyAdmin(paymentId) {
  console.log(`New payment created: ${paymentId}`)
}

async function sendCourseAccessEmail(email, name, courseName) {
  try {
    const transporter = createTransporter()

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "তালিমুল ইসলাম একাডেমি - কোর্স অনুমোদিত হয়েছে",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4caf50;">🎉 অভিনন্দন!</h2>
          <p>প্রিয় ${name},</p>
          <p>আপনার পেমেন্ট সফলভাবে অনুমোদিত হয়েছে এবং <strong>"${courseName}"</strong> কোর্সে আপনার অ্যাক্সেস চালু করা হয়েছে।</p>
          <p>এখন আপনি সমস্ত ভিডিও, নোট এবং অন্যান্য কন্টেন্ট দেখতে পারবেন।</p>
          <p style="margin-top: 20px;">
            <a href="https://your-course-website.com/practical-ibarat" 
               style="background: #4caf50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">
              কোর্স শুরু করুন
            </a>
          </p>
          <p style="margin-top: 20px; color: #666;">
            ধন্যবাদ,<br>
            তালিমুল ইসলাম একাডেমি টিম
          </p>
        </div>
      `,
    }

    await transporter.sendMail(mailOptions)
    console.log(`Course access email sent to ${email}`)
  } catch (error) {
    console.error("Error sending course access email:", error)
    throw error
  }
}

// WebSocket কানেকশন
io.on("connection", (socket) => {
  console.log("A user connected")
  socket.on("disconnect", () => {
    console.log("A user disconnected")
  })
})

// Error handling middleware
app.use("*", (req, res) => {
  res.setHeader("Content-Type", "application/json")
  res.status(404).json({
    success: false,
    message: "API endpoint পাওয়া যায়নি",
    path: req.originalUrl,
  })
})

app.use((error, req, res, next) => {
  console.error("Global error handler:", error)
  res.setHeader("Content-Type", "application/json")
  res.status(500).json({
    success: false,
    message: "সার্ভার এরর হয়েছে",
    error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
  })
})

// সার্ভার শুরু করুন
const PORT = process.env.PORT || 5000
server.listen(PORT, () => console.log(`Server running on port ${PORT}`))