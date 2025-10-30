const express = require("express");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const cors = require("cors");
const dotenv = require("dotenv");
const http = require("http");
const { Server } = require("socket.io");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

dotenv.config();
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

// MongoDB কানেকশন
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.error("MongoDB Connection Error:", err));

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
);

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
);

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
);

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
);

// মিডলওয়্যার
app.use(cors());
app.use(express.json());

// ইমেইল ট্রান্সপোর্টার ফাংশন (ফিক্সড)
const createEmailTransporter = () => {
  // পাসওয়ার্ড থেকে স্পেস রিমুভ
  const emailPass = process.env.EMAIL_PASS ? process.env.EMAIL_PASS.replace(/\s/g, '') : '';
  
  return nodemailer.createTransporter({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: emailPass,
    },
    tls: {
      rejectUnauthorized: false
    }
  });
};

// ====== টেস্ট ইমেইল রাউট ======
app.post("/api/test-email", async (req, res) => {
  try {
    const { toEmail = "billaharif661@gmail.com" } = req.body;
    
    const transporter = createEmailTransporter();
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: toEmail,
      subject: "তালিমুল ইসলাম একাডেমি - টেস্ট ইমেইল",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #4caf50; text-align: center;">টেস্ট ইমেইল সফল!</h2>
          <div style="background: #f8f9fa; padding: 20px; border-radius: 10px;">
            <p style="font-size: 16px;">এইটি একটি টেস্ট ইমেইল যা আপনার সার্ভার থেকে পাঠানো হয়েছে।</p>
            <p style="color: #666; font-size: 14px;">সময়: ${new Date().toLocaleString()}</p>
          </div>
          <p style="margin-top: 20px; color: #666; text-align: center;">
            ধন্যবাদ,<br>
            তালিমুল ইসলাম একাডেমি টিম
          </p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    
    console.log(`Test email sent successfully to ${toEmail}`);
    
    res.json({ 
      success: true, 
      message: "টেস্ট ইমেইল সফলভাবে পাঠানো হয়েছে",
      to: toEmail 
    });
  } catch (error) {
    console.error("Test email error:", error);
    res.status(500).json({ 
      success: false, 
      message: "টেস্ট ইমেইল পাঠাতে ব্যর্থ হয়েছে",
      error: error.message 
    });
  }
});

// ====== পেমেন্ট ভ্যালিডেশন মিডলওয়্যার ======
const validatePayment = (req, res, next) => {
  const { name, email, phone, courseId, paymentMethod, txnId, amount } = req.body;

  if (!name || !email || !phone || !courseId || !paymentMethod || !txnId || !amount) {
    return res.status(400).json({ message: "সমস্ত প্রয়োজনীয় ফিল্ড পূরণ করুন" });
  }

  if (!["bkash", "nagad", "bank", "card"].includes(paymentMethod)) {
    return res.status(400).json({ message: "অবৈধ পেমেন্ট মাধ্যম" });
  }

  next();
};

// ======= পাসওয়ার্ড রিসেট রাউটস =======

// ফরগট পাসওয়ার্ড
app.post("/api/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    // ইউজার এক্সিস্টেন্স চেক
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: "এই ইমেইলটি রেজিস্টার্ড নয়" 
      });
    }

    // OTP জেনারেট
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // ইমেইল ট্রান্সপোর্টার
    const transporter = createEmailTransporter();

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

    await transporter.sendMail(mailOptions);

    // OTP ডাটাবেজে সেভ করুন
    user.otp = otp;
    user.otpExpires = Date.now() + 300000; // 5 minutes
    await user.save();

    console.log(`Password reset OTP sent to ${email}: ${otp}`);

    res.json({ 
      success: true, 
      message: "OTP সফলভাবে পাঠানো হয়েছে" 
    });

  } catch (error) {
    console.error("Error in forgot password:", error);
    res.status(500).json({ 
      success: false, 
      message: "পাসওয়ার্ড রিসেট করতে সমস্যা হয়েছে",
      error: error.message 
    });
  }
});

// OTP যাচাইকরণ
app.post("/api/verify-reset-otp", async (req, res) => {
  try {
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

// নতুন পাসওয়ার্ড সেট
app.post("/api/reset-password", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    console.log(`Resetting password for ${email} with OTP: ${otp}`);

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "সমস্ত প্রয়োজনীয় ফিল্ড পূরণ করুন",
      });
    }

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
      console.log(`Password reset failed - OTP mismatch for ${email}`);
      return res.status(400).json({
        success: false,
        message: "অবৈধ OTP অথবা OTP এর মেয়াদ শেষ",
      });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    console.log(`Updating password for ${email} in MongoDB`);

    const updateResult = await User.findOneAndUpdate(
      { email: email },
      {
        $set: { password: hashedPassword },
        $unset: { otp: "", otpExpires: "" },
      },
      { new: true }
    );

    if (!updateResult) {
      console.error(`Failed to update password for ${email}`);
      return res.status(500).json({
        success: false,
        message: "পাসওয়ার্ড আপডেট করতে সমস্যা হয়েছে",
      });
    }

    console.log(`Password successfully updated for ${email} in MongoDB`);

    res.json({
      success: true,
      message: "পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে। এখন নতুন পাসওয়ার্ড দিয়ে লগইন করুন।",
    });
  } catch (error) {
    console.error("পাসওয়ার্ড রিসেট করতে সমস্যা:", error);
    res.status(500).json({
      success: false,
      message: "পাসওয়ার্ড রিসেট করতে সমস্যা হয়েছে",
    });
  }
});

// ======= OTP রাউটস =======
app.post("/api/send-otp", async (req, res) => {
  try {
    const { email } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const transporter = createEmailTransporter();

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

    await transporter.sendMail(mailOptions);

    // শুধুমাত্র existing user-এর জন্য OTP update করা হবে
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

    console.log(`OTP sent to ${email}: ${otp}`);

    res.json({ success: true, message: "OTP সফলভাবে পাঠানো হয়েছে" });
  } catch (error) {
    console.error("Error sending OTP:", error);
    res.status(500).json({ 
      success: false, 
      message: "OTP পাঠাতে সমস্যা হয়েছে",
      error: error.message 
    });
  }
});

// OTP যাচাই
app.post("/api/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    // First check in temporary storage for new users
    if (global.tempOTPs && global.tempOTPs[email]) {
      const tempOTP = global.tempOTPs[email];
      if (tempOTP.otp === otp && tempOTP.expires > Date.now()) {
        delete global.tempOTPs[email];
        return res.json({ success: true });
      }
      return res.status(400).json({
        success: false,
        message: "Invalid OTP or expired",
      });
    }

    // Then check in database for existing users
    const user = await User.findOne({ email });
    if (!user || !user.otp) {
      return res.status(400).json({
        success: false,
        message: "OTP not found or expired",
      });
    }

    if (user.otp !== otp) {
      return res.status(400).json({
        success: false,
        message: "OTP doesn't match",
      });
    }

    if (user.otpExpires < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "OTP expired",
      });
    }

    // Clear OTP after successful verification
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    res.json({ success: true });
  } catch (error) {
    console.error("Error verifying OTP:", error);
    res.status(500).json({
      success: false,
      message: "Error verifying OTP",
    });
  }
});

// ======= পেমেন্ট রাউটস =======
app.post("/api/payments", validatePayment, async (req, res) => {
  try {
    const payment = new Payment(req.body);
    await payment.save();

    await notifyAdmin(payment._id);

    res.status(201).json(payment);
  } catch (error) {
    console.error("Error saving payment:", error);
    res.status(500).json({ message: "পেমেন্ট সেভ করতে সমস্যা হয়েছে" });
  }
});

app.get("/api/admin/payments", async (req, res) => {
  try {
    const { status, page = 1, limit = 10, search = "" } = req.query;

    const query = {};
    if (status) query.status = status;

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { txnId: { $regex: search, $options: "i" } },
      ];
    }

    const payments = await Payment.find(query)
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const count = await Payment.countDocuments(query);

    res.json({
      payments,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
    });
  } catch (error) {
    console.error("Error fetching payments:", error);
    res.status(500).json({ message: "পেমেন্ট লোড করতে সমস্যা হয়েছে" });
  }
});

app.get("/api/admin/payments/:id", async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({ message: "পেমেন্ট পাওয়া যায়নি" });
    }
    res.json(payment);
  } catch (error) {
    console.error("Error fetching payment:", error);
    res.status(500).json({ message: "পেমেন্ট ডিটেইলস লোড করতে সমস্যা হয়েছে" });
  }
});

// পেমেন্ট আপডেট
app.put("/api/admin/payments/:id", async (req, res) => {
  try {
    const { status } = req.body;

    if (!status || !["approved", "rejected", "pending"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value. Only approved, rejected or pending accepted",
      });
    }

    const payment = await Payment.findByIdAndUpdate(req.params.id, { status }, { new: true });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    console.log(`Payment ${payment._id} status updated to: ${status}`);

    if (status === "approved") {
      const user = await User.findOneAndUpdate(
        { email: payment.email },
        { $addToSet: { courses: payment.courseId } },
        { new: true, upsert: true }
      );

      console.log(`User ${payment.email} granted access to course ${payment.courseId}`);

      const notification = {
        type: "courseAccessUpdated",
        email: payment.email,
        courseId: payment.courseId,
        courseName: payment.courseName,
        paymentId: payment._id,
        userName: payment.name,
        timestamp: new Date().toISOString(),
      };

      io.emit("courseAccessUpdated", notification);

      console.log("Course access notification broadcasted:", notification);

      try {
        await sendCourseAccessEmail(payment.email, payment.name, payment.courseName || payment.courseId);
      } catch (emailError) {
        console.error("Failed to send email notification:", emailError);
      }
    }

    res.json({
      success: true,
      message: "Payment status updated successfully",
      payment,
    });
  } catch (error) {
    console.error("Error updating payment:", error);
    res.status(500).json({
      success: false,
      message: "Error updating payment",
      error: error.message,
    });
  }
});

// ======= রিভিউ রাউটস =======
app.get("/api/reviews/:courseId", async (req, res) => {
  try {
    const { courseId } = req.params;
    const reviews = await Review.find({
      courseId,
      isApproved: true,
    }).sort({ date: -1 });

    res.setHeader("Content-Type", "application/json");
    res.json({ success: true, reviews });
  } catch (error) {
    console.error("Error fetching reviews:", error);
    res.setHeader("Content-Type", "application/json");
    res.status(500).json({ success: false, message: "রিভিউ লোড করতে সমস্যা হয়েছে", error: error.message });
  }
});

app.post("/api/reviews", async (req, res) => {
  try {
    const { courseId, reviewerName, reviewerEmail, rating, reviewText } = req.body;

    if (!courseId || !reviewerName || !reviewerEmail || !rating || !reviewText) {
      return res.status(400).json({
        success: false,
        message: "সমস্ত প্রয়োজনীয় ফিল্ড পূরণ করুন",
      });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: "রেটিং ১ থেকে ৫ এর মধ্যে হতে হবে",
      });
    }

    const existingReview = await Review.findOne({
      courseId,
      reviewerEmail,
    });

    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: "আপনি ইতিমধ্যে এই কোর্সের রিভিউ দিয়েছেন",
      });
    }

    const review = new Review({
      courseId,
      reviewerName,
      reviewerEmail,
      rating: Number.parseInt(rating),
      reviewText,
    });

    await review.save();

    res.setHeader("Content-Type", "application/json");
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
    });
  } catch (error) {
    console.error("Error submitting review:", error);
    res.setHeader("Content-Type", "application/json");
    res.status(500).json({
      success: false,
      message: "রিভিউ জমা দিতে সমস্যা হয়েছে",
      error: error.message,
    });
  }
});

app.get("/api/admin/reviews", async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;

    const query = {};
    if (status === "pending") query.isApproved = false;
    if (status === "approved") query.isApproved = true;

    const reviews = await Review.find(query)
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const count = await Review.countDocuments(query);

    res.json({
      success: true,
      reviews,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
    });
  } catch (error) {
    console.error("Error fetching admin reviews:", error);
    res.status(500).json({ success: false, message: "রিভিউ লোড করতে সমস্যা হয়েছে" });
  }
});

app.put("/api/admin/reviews/:id", async (req, res) => {
  try {
    const { isApproved } = req.body;

    const review = await Review.findByIdAndUpdate(req.params.id, { isApproved }, { new: true });

    if (!review) {
      return res.status(404).json({ success: false, message: "রিভিউ পাওয়া যায়নি" });
    }

    res.json({
      success: true,
      message: `রিভিউ ${isApproved ? "অনুমোদিত" : "প্রত্যাখ্যাত"} হয়েছে`,
      review,
    });
  } catch (error) {
    console.error("Error updating review:", error);
    res.status(500).json({ success: false, message: "রিভিউ আপডেট করতে সমস্যা হয়েছে" });
  }
});

// ======= কোর্স রাউটস =======
app.get("/api/courses", async (req, res) => {
  try {
    const courses = await Course.find();
    res.json(courses);
  } catch (error) {
    console.error("Error fetching courses:", error);
    res.status(500).json({ message: "কোর্স লোড করতে সমস্যা হয়েছে" });
  }
});

app.get("/api/users/:email/courses", async (req, res) => {
  try {
    const user = await User.findOne({ email: req.params.email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({ courses: user.courses || [] });
  } catch (error) {
    console.error("Error fetching user courses:", error);
    res.status(500).json({ message: "Error fetching user courses" });
  }
});

// ======= অথেন্টিকেশন রাউটস =======
const saltRounds = 10;

app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const user = new User({
      name,
      email,
      password: hashedPassword,
      courses: [],
    });

    await user.save();

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "1d" });

    res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        courses: user.courses,
      },
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Registration failed" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "1d" });

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        courses: user.courses,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Login failed" });
  }
});

// ======= হেল্পার ফাংশন =======
async function notifyAdmin(paymentId) {
  console.log(`New payment created: ${paymentId}`);
}

async function notifyUser(email, courseId) {
  console.log(`User with email ${email} granted access to course ${courseId}`);
}

async function sendCourseAccessEmail(email, name, courseName) {
  try {
    const transporter = createEmailTransporter();

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
    };

    await transporter.sendMail(mailOptions);
    console.log(`Course access email sent to ${email}`);
  } catch (error) {
    console.error("Error sending course access email:", error);
    throw error;
  }
}

// ======= WebSocket কানেকশন =======
io.on("connection", (socket) => {
  console.log("A user connected");
  socket.on("disconnect", () => {
    console.log("A user disconnected");
  });
});

// ======= এরর হ্যান্ডলিং =======
app.use("*", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.status(404).json({
    success: false,
    message: "API endpoint পাওয়া যায়নি",
    path: req.originalUrl,
  });
});

app.use((error, req, res, next) => {
  console.error("Global error handler:", error);
  res.setHeader("Content-Type", "application/json");
  res.status(500).json({
    success: false,
    message: "সার্ভার এরর হয়েছে",
    error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
  });
});

// ======= সার্ভার শুরু =======
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Test email endpoint: http://localhost:${PORT}/api/test-email`);
});