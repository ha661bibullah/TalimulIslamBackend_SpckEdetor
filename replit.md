# তালিমুল ইসলাম একাডেমি - Backend API

## 📋 প্রজেক্ট সম্পর্কে
এটি তালিমুল ইসলাম একাডেমির ব্যাকএন্ড API সার্ভার। এখানে Gmail OTP authentication, payment management, course management এবং review system আছে।

## 🚀 প্রধান বৈশিষ্ট্য
- ✅ Gmail App Password দিয়ে OTP পাঠানো (Registration ও Password Reset)
- ✅ MongoDB database integration
- ✅ Socket.IO দিয়ে real-time notifications
- ✅ Payment management system
- ✅ Course review system
- ✅ Detailed error logging

## 📧 Gmail OTP সেটআপ
**GMAIL_SETUP_GUIDE.md** ফাইল দেখুন সম্পূর্ণ নির্দেশনার জন্য।

### দ্রুত সেটআপ:
1. Gmail এ 2-Step Verification চালু করুন
2. App Password তৈরি করুন (16-digit)
3. .env ফাইলে EMAIL_USER এবং EMAIL_PASS সেট করুন

## 🛠️ প্রযুক্তি Stack
- **Runtime:** Node.js 16+
- **Framework:** Express.js
- **Database:** MongoDB (Mongoose)
- **Email:** Nodemailer with Gmail SMTP
- **Real-time:** Socket.IO
- **Authentication:** JWT, bcryptjs

## 📁 প্রজেক্ট Structure
```
├── server.js              # Main server file
├── package.json           # Dependencies
├── .env                   # Environment variables (create this)
├── .env.example           # Example env file
├── GMAIL_SETUP_GUIDE.md   # Gmail setup instructions
└── replit.md             # This file
```

## 🔧 Environment Variables
Required variables (see `.env.example`):
- `MONGO_URI` - MongoDB connection string
- `JWT_SECRET` - Secret for JWT tokens
- `EMAIL_USER` - Gmail address
- `EMAIL_PASS` - Gmail App Password (16-digit)
- `FRONTEND_URL` - Frontend URL for CORS
- `PORT` - Server port (default: 5000)

## 📡 API Endpoints

### OTP Routes (Registration)
- `POST /api/send-otp` - Send OTP for registration
- `POST /api/verify-otp` - Verify registration OTP

### Password Reset Routes
- `POST /api/forgot-password` - Request password reset OTP
- `POST /api/verify-reset-otp` - Verify reset OTP
- `POST /api/reset-password` - Reset password with OTP

### User Routes
- `GET /api/users/:email/courses` - Get user's enrolled courses

### Payment Routes
- `POST /api/payments` - Submit payment
- `GET /api/admin/payments` - Get all payments (admin)
- `GET /api/admin/payments/:id` - Get payment details
- `PUT /api/admin/payments/:id` - Update payment status

### Review Routes
- `GET /api/reviews/:courseId` - Get course reviews
- `POST /api/reviews` - Submit review
- `GET /api/admin/reviews` - Get all reviews (admin)
- `PUT /api/admin/reviews/:id` - Approve/reject review

## 🔍 Debugging

### Email সংক্রান্ত সমস্যা
Server console log দেখুন:
- ✅ "Gmail SMTP connection verified successfully" - সব ঠিক আছে
- ❌ "Gmail SMTP connection failed" - App Password চেক করুন

### Common Issues
1. **OTP email যাচ্ছে না:**
   - App Password সঠিক কিনা চেক করুন
   - 2-Step Verification চালু আছে কিনা দেখুন
   - GMAIL_SETUP_GUIDE.md পড়ুন

2. **Database connection error:**
   - MONGO_URI সঠিক কিনা verify করুন
   - MongoDB Atlas network access চেক করুন

3. **Port already in use:**
   - .env ফাইলে PORT পরিবর্তন করুন

## 📊 প্রজেক্ট Status
- Last Updated: October 26, 2025
- Version: 1.0.0
- Status: ✅ Active Development

## 🔐 Security Notes
- Never commit .env file
- Use App Password, not regular Gmail password
- Keep JWT_SECRET secure
- Enable 2-Step Verification on Gmail

## 📝 Recent Changes
- ✅ Fixed Gmail OTP sending issues
- ✅ Added detailed error logging
- ✅ Created beautiful Bangla email templates
- ✅ Added Gmail App Password setup guide
- ✅ Improved Nodemailer configuration

## 🎯 Next Steps
1. Set up EMAIL_USER and EMAIL_PASS in Secrets
2. Configure MONGO_URI
3. Set JWT_SECRET
4. Test OTP functionality
5. Deploy to production (Render)
