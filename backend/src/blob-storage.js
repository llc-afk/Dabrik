const { del, put } = require("@vercel/blob");
const crypto = require("crypto");

function validateImage(dataUrl) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) {
    throw Object.assign(new Error("Use fotos JPG, PNG ou WebP."), { status: 400 });
  }
  const extension = match[1] === "jpeg" ? "jpg" : match[1];
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > 1_000_000) {
    throw Object.assign(new Error("Cada foto precisa ter até 1 MB."), { status: 400 });
  }
  const valid = (match[1] === "jpeg" && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    || (match[1] === "png" && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) )
    || (match[1] === "webp" && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP");
  if (!valid) {
    throw Object.assign(new Error("O arquivo enviado não parece ser uma foto válida."), { status: 400 });
  }
  return { buffer, extension, contentType: `image/${match[1]}` };
}

async function saveImages(images, productId) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("Configure BLOB_READ_WRITE_TOKEN para armazenar fotos.");
  }
  const urls = [];
  for (const image of images) {
    const { buffer, extension, contentType } = validateImage(image);
    const result = await put(
      `dabrik/products/${productId}/${crypto.randomUUID()}.${extension}`,
      buffer,
      { access: "public", addRandomSuffix: true, contentType },
    );
    urls.push(result.url);
  }
  return urls;
}

async function deleteImages(images = []) {
  const urls = images.filter((value) => {
    try {
      return new URL(value).hostname.endsWith(".blob.vercel-storage.com");
    } catch {
      return false;
    }
  });
  if (urls.length) await del(urls);
}

module.exports = { deleteImages, saveImages, validateImage };
