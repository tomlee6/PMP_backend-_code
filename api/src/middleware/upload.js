const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');

['csv', 'bills', 'misc'].forEach(sub => {
  fs.mkdirSync(path.join(uploadDir, sub), { recursive: true });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let subDir = 'misc';
    if (file.fieldname === 'bill') subDir = 'bills';
    else if (file.fieldname === 'csv') subDir = 'csv';
    cb(null, path.join(uploadDir, subDir));
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'csv') {
      if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) return cb(null, true);
      return cb(new Error('Only CSV files are allowed'));
    }
    cb(null, true);
  }
});

module.exports = upload;
