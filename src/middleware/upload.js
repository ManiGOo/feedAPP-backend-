import multer from "multer";

const storage = multer.memoryStorage(); // keep files in memory before upload
const upload = multer({ storage });

export default upload;
