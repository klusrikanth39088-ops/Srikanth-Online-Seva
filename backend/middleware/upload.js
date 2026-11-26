const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { getAppUploadDir } = require('../utils/helpers');

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB per file
const ALLOWED_EXTS = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
const ALLOWED_MIMES = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']);

function validateMagicBytes(buffer, ext) {
  if (!buffer || buffer.length < 4) return false;
  if (ext === '.pdf') {
    return buffer.slice(0, 4).toString('ascii') === '%PDF';
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (ext === '.png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }
  return false;
}

const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 20
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    if (!ALLOWED_EXTS.has(ext) || !ALLOWED_MIMES.has(mime)) {
      return cb(new Error(`Invalid file type for "${file.fieldname}". Only PDF, JPG, JPEG, and PNG files are allowed.`));
    }
    return cb(null, true);
  }
});

function saveFilesForApplication(uniqueAppId, uploadedFiles = [], existingFilesMap = {}) {
  const dir = getAppUploadDir(uniqueAppId);
  const updatedMap = { ...existingFilesMap };

  for (const file of uploadedFiles) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXTS.has(ext) || !validateMagicBytes(file.buffer, ext)) {
      throw new Error(`Security check failed: "${file.originalname}" is not a valid PDF/JPEG/PNG file.`);
    }

    const safeField = String(file.fieldname || 'doc').replace(/[^a-zA-Z0-9_-]/g, '_');
    const storedName = `${safeField}-${Date.now()}${ext}`;
    const destPath = path.join(dir, storedName);

    // Remove old replaced file for same field if present
    if (updatedMap[safeField] && updatedMap[safeField].storedName) {
      const prevPath = path.join(dir, path.basename(updatedMap[safeField].storedName));
      if (fs.existsSync(prevPath)) {
        try {
          fs.unlinkSync(prevPath);
        } catch {
          // ignore cleanup failure
        }
      }
    }

    fs.writeFileSync(destPath, file.buffer);
    updatedMap[safeField] = {
      fieldName: safeField,
      originalName: file.originalname,
      storedName,
      mimeType: file.mimetype,
      size: file.size,
      uploadedAt: new Date().toISOString()
    };
  }

  return updatedMap;
}

module.exports = {
  uploadMiddleware,
  saveFilesForApplication,
  MAX_FILE_SIZE_BYTES
};

