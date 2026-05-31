// busboy-based multipart parser for Vercel serverless functions
const Busboy = require('busboy');

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const files = [];

    const busboy = Busboy({ headers: req.headers });

    busboy.on('field', (name, value) => {
      fields[name] = value;
    });

    busboy.on('file', (name, stream, info) => {
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {
        files.push({
          fieldname: name,
          originalname: info.filename,
          mimetype: info.mimeType,
          buffer: Buffer.concat(chunks),
        });
      });
    });

    busboy.on('finish', () => resolve({ fields, files }));
    busboy.on('error', reject);

    if (req.body instanceof Buffer || typeof req.body === 'string') {
      busboy.end(req.body);
    } else {
      req.pipe(busboy);
    }
  });
}

module.exports = { parseMultipart };
