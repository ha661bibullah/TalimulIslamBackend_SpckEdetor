# Render এ ডিপ্লয়মেন্ট গাইড

## ১. Render এ অ্যাকাউন্ট তৈরি করুন
- https://render.com এ যান
- GitHub দিয়ে সাইন আপ করুন

## ২. MongoDB Atlas সেটআপ করুন
- https://cloud.mongodb.com এ যান
- ফ্রি ক্লাস্টার তৈরি করুন
- Connection String কপি করুন

## ৩. GitHub এ কোড আপলোড করুন
\`\`\`bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/yourusername/your-repo.git
git push -u origin main
\`\`\`

## ৪. Render এ Web Service তৈরি করুন
- "New" > "Web Service" ক্লিক করুন
- GitHub repo সিলেক্ট করুন
- Build Command: `npm install`
- Start Command: `npm start`

## ৫. Environment Variables সেট করুন
\`\`\`
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/educational_platform
JWT_SECRET=your-super-secret-jwt-key
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
FRONTEND_URL=https://your-frontend-domain.com
NODE_ENV=production
PORT=10000
\`\`\`

## ৬. ডিপ্লয় করুন
- "Create Web Service" ক্লিক করুন
- ডিপ্লয়মেন্ট সম্পূর্ণ হওয়ার জন্য অপেক্ষা করুন

## ৭. ফ্রন্টএন্ড কানেকশন
- আপনার Render URL কপি করুন (যেমন: https://your-app.onrender.com)
- frontend-integration/api.js ফাইলে baseURL আপডেট করুন
