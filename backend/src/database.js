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

async function close() {
  if (pool) await pool.end();
}

module.exports = {
  close,
  createProduct,
  createUser,
  deleteProduct,
  ensureSchema,
  findUserByEmail,
  findUserById,
  readStore,
  updateProduct,
  updateProductStatus,
};
