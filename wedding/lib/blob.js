// Vercel Blob storage helpers — reads BLOB_READ_WRITE_TOKEN from env
const { put, list, del } = require('@vercel/blob');

async function uploadPhoto(prefix, filename, buffer, contentType) {
  const blob = await put(`${prefix}/${filename}`, buffer, {
    access: 'public',
    contentType,
  });
  return blob.url;
}

async function listPhotos(prefix) {
  const { blobs } = await list({ prefix: `${prefix}/` });
  return blobs.map(b => ({
    url: b.url,
    filename: b.pathname.split('/').pop(),
    uploadedAt: b.uploadedAt,
  }));
}

async function deletePhotoByFilename(prefix, filename) {
  const { blobs } = await list({ prefix: `${prefix}/${filename}` });
  if (blobs.length === 0) return false;
  await del(blobs[0].url);
  return true;
}

async function deletePhotoByUrl(url) {
  await del(url);
}

module.exports = { uploadPhoto, listPhotos, deletePhotoByFilename, deletePhotoByUrl };
