const { Pool } = require("pg");

let pool;
let schemaReady;

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Configure DATABASE_URL para usar o PostgreSQL.");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 5),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      ssl: process.env.PGSSLMODE === "disable" ? false : undefined,
    });
  }
  return pool;
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = getPool()
      .query(`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          phone TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS products (
          id UUID PRIMARY KEY,
          owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          category TEXT NOT NULL,
          price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
          city TEXT NOT NULL,
          state CHAR(2) NOT NULL,
          images TEXT[] NOT NULL DEFAULT '{}',
          share_phone BOOLEAN NOT NULL DEFAULT FALSE,
          status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'PAUSED', 'SOLD')),
          created_at TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS products_active_created_idx
          ON products (created_at DESC) WHERE status = 'ACTIVE';
        CREATE INDEX IF NOT EXISTS products_owner_created_idx
          ON products (owner_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS product_reports (
          id UUID PRIMARY KEY,
          product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          reason TEXT NOT NULL,
          details TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (product_id, reporter_id)
        );
        CREATE TABLE IF NOT EXISTS conversations (
          id UUID PRIMARY KEY,
          product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          buyer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          seller_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (product_id, buyer_id),
          CHECK (buyer_id <> seller_id)
        );
        CREATE INDEX IF NOT EXISTS conversations_participants_idx
          ON conversations (buyer_id, seller_id, updated_at DESC);
        CREATE TABLE IF NOT EXISTS messages (
          id UUID PRIMARY KEY,
          conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
          ON messages (conversation_id, created_at ASC);
      `)
      .then(() => undefined)
      .catch((error) => {
        schemaReady = undefined;
        throw error;
      });
  }
  return schemaReady;
}

function mapUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    passwordHash: row.password_hash,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapProduct(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    price: Number(row.price),
    city: row.city,
    state: row.state,
    images: row.images || [],
    sharePhone: row.share_phone,
    ownerId: row.owner_id,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function readStore() {
  await ensureSchema();
  const client = getPool();
  const [users, products] = await Promise.all([
    client.query("SELECT * FROM users"),
    client.query("SELECT * FROM products"),
  ]);
  return {
    users: users.rows.map(mapUser),
    products: products.rows.map(mapProduct),
  };
}

async function findUserByEmail(email) {
  await ensureSchema();
  const result = await getPool().query("SELECT * FROM users WHERE email = $1", [email]);
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

async function findUserById(id) {
  await ensureSchema();
  const result = await getPool().query("SELECT * FROM users WHERE id = $1", [id]);
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

async function createUser(user) {
  await ensureSchema();
  const result = await getPool().query(
    `INSERT INTO users (id, name, email, phone, password_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    [user.id, user.name, user.email, user.phone, user.passwordHash, user.createdAt],
  );
  return result.rowCount === 1;
}

async function createProduct(product) {
  await ensureSchema();
  await getPool().query(
    `INSERT INTO products
      (id, owner_id, title, description, category, price, city, state, images, share_phone, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [product.id, product.ownerId, product.title, product.description, product.category,
      product.price, product.city, product.state, product.images, product.sharePhone,
      product.status, product.createdAt],
  );
}

async function updateProduct(id, ownerId, product) {
  await ensureSchema();
  const result = await getPool().query(
    `UPDATE products SET title=$3, description=$4, category=$5, price=$6, city=$7,
      state=$8, images=$9, share_phone=$10 WHERE id=$1 AND owner_id=$2 RETURNING id`,
    [id, ownerId, product.title, product.description, product.category, product.price,
      product.city, product.state, product.images, product.sharePhone],
  );
  return result.rowCount === 1;
}

async function updateProductStatus(id, ownerId, status) {
  await ensureSchema();
  const result = await getPool().query(
    "UPDATE products SET status=$3 WHERE id=$1 AND owner_id=$2 RETURNING id",
    [id, ownerId, status],
  );
  return result.rowCount === 1;
}

async function deleteProduct(id, ownerId) {
  await ensureSchema();
  const result = await getPool().query(
    "DELETE FROM products WHERE id=$1 AND owner_id=$2 RETURNING id",
    [id, ownerId],
  );
  return result.rowCount === 1;
}

async function createProductReport(report) {
  await ensureSchema();
  const result = await getPool().query(
    `INSERT INTO product_reports (id, product_id, reporter_id, reason, details, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (product_id, reporter_id) DO NOTHING RETURNING id`,
    [report.id, report.productId, report.reporterId, report.reason, report.details, report.createdAt],
  );
  return result.rowCount === 1;
}

async function createConversation(conversation) {
  await ensureSchema();
  const result = await getPool().query(
    `INSERT INTO conversations (id, product_id, buyer_id, seller_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (product_id, buyer_id) DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [conversation.id, conversation.productId, conversation.buyerId, conversation.sellerId],
  );
  return result.rows[0].id;
}

async function listConversations(userId) {
  await ensureSchema();
  const result = await getPool().query(
    `SELECT c.id, c.product_id AS "productId", p.title AS "productTitle",
       CASE WHEN c.buyer_id = $1 THEN seller.name ELSE buyer.name END AS "otherName",
       (SELECT m.content FROM messages m WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC LIMIT 1) AS "lastMessage",
       c.updated_at AS "updatedAt"
     FROM conversations c
     JOIN products p ON p.id = c.product_id
     JOIN users buyer ON buyer.id = c.buyer_id
     JOIN users seller ON seller.id = c.seller_id
     WHERE c.buyer_id = $1 OR c.seller_id = $1
     ORDER BY c.updated_at DESC`,
    [userId],
  );
  return result.rows.map((row) => ({
    ...row,
    updatedAt: new Date(row.updatedAt).toISOString(),
  }));
}

async function findConversationForUser(id, userId) {
  await ensureSchema();
  const result = await getPool().query(
    `SELECT id, product_id AS "productId", buyer_id AS "buyerId", seller_id AS "sellerId"
     FROM conversations WHERE id = $1 AND (buyer_id = $2 OR seller_id = $2)`,
    [id, userId],
  );
  return result.rows[0] || null;
}

async function listMessages(conversationId) {
  await ensureSchema();
  const result = await getPool().query(
    `SELECT m.id, m.sender_id AS "senderId", u.name AS "senderName", m.content,
       m.created_at AS "createdAt"
     FROM messages m JOIN users u ON u.id = m.sender_id
     WHERE m.conversation_id = $1 ORDER BY m.created_at ASC`,
    [conversationId],
  );
  return result.rows.map((row) => ({
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
  }));
}

async function createMessage(message, conversationId) {
  await ensureSchema();
  const client = getPool();
  await client.query(
    `INSERT INTO messages (id, conversation_id, sender_id, content, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [message.id, conversationId, message.senderId, message.content, message.createdAt],
  );
  await client.query("UPDATE conversations SET updated_at = $2 WHERE id = $1", [
    conversationId,
    message.createdAt,
  ]);
}

async function close() {
  if (pool) await pool.end();
}

module.exports = {
  close,
  createConversation,
  createMessage,
  createProduct,
  createProductReport,
  createUser,
  deleteProduct,
  ensureSchema,
  findUserByEmail,
  findUserById,
  findConversationForUser,
  listConversations,
  listMessages,
  readStore,
  updateProduct,
  updateProductStatus,
};
