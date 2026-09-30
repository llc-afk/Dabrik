const siteConfig = window.DABRIK_CONFIG || {};
const BASE_PATH = normalizeBasePath(siteConfig.basePath || "/");
const API_BASE_URL = String(siteConfig.apiBaseUrl || "").replace(/\/+$/, "");
const API = API_BASE_URL ? `${API_BASE_URL}/api` : `${BASE_PATH}api`.replace(/\/+/g, "/");
const categories = [
  "Automóveis",
  "Casa e jardim",
  "Celulares e tablets",
  "Eletrodomésticos",
  "Esportes e lazer",
  "Imóveis",
  "Moda e beleza",
  "Móveis",
  "Serviços",
  "Tecnologia",
  "Ferramentas",
  "Outros",
];
let products = [];
let toastTimer;
let apiProblem = "";

function normalizeBasePath(value) {
  const path = `/${String(value).replace(/^\/+|\/+$/g, "")}/`;
  return path === "//" ? "/" : path;
}

function imageUrl(value) {
  try {
    return new URL(value, API_BASE_URL || window.location.origin).href;
  } catch {
    return "";
  }
}

function apiUnavailableMessage() {
  if (location.hostname.endsWith("github.io") && !API_BASE_URL) {
    return "O backend ainda não está conectado. Publique o servidor DaBrik e configure a variável DABRIK_API_BASE_URL no GitHub.";
  }
  return "Não foi possível conectar ao servidor DaBrik. Tente novamente em instantes.";
}

const money = (value) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function toast(message) {
  const element = document.querySelector("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 3500);
}

function token() {
  return localStorage.getItem("dabrik-token") || "";
}

async function api(path, options = {}) {
  if (location.hostname.endsWith("github.io") && !API_BASE_URL) {
    throw new Error(apiUnavailableMessage());
  }
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  if (token()) headers.Authorization = `Bearer ${token()}`;
  const response = await fetch(`${API}${path}`, { ...options, headers });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}

function pageTop(title, subtitle) {
  return `<div class="page-top"><div class="container"><div class="breadcrumbs"><a href="/" data-link>Início</a>　/　${escapeHTML(title)}</div><h1>${escapeHTML(title)}</h1><p>${escapeHTML(subtitle)}</p></div></div>`;
}

function emptyState(title, message, action = true) {
  return `<div class="empty"><strong>${escapeHTML(title)}</strong><p>${escapeHTML(message)}</p>${action ? '<a class="btn-primary" data-link href="/anunciar">Anunciar grátis</a>' : ""}</div>`;
}

function connectionNotice() {
  return apiProblem
    ? `<div class="container"><div class="notice api-notice">${escapeHTML(apiProblem)}</div></div>`
    : "";
}

async function loadProducts(path) {
  try {
    const result = await api(path);
    apiProblem = "";
    return result;
  } catch (error) {
    apiProblem =
      error.message === "Failed to fetch" ? apiUnavailableMessage() : error.message;
    return { items: [] };
  }
}

function productCard(product) {
  const photo = product.images?.[0];
  const image = photo
    ? `<img src="${escapeHTML(imageUrl(photo))}" alt="${escapeHTML(product.title)}" loading="lazy">`
    : '<div class="no-photo">Sem foto</div>';
  return `<article class="product-card"><a class="product-link" data-link href="/produto/${encodeURIComponent(product.id)}"><div class="product-image">${image}<span class="badge">${escapeHTML(product.category)}</span></div><div class="product-info"><h3 class="product-title">${escapeHTML(product.title)}</h3><div class="price-row"><span class="price">${money(product.price)}</span></div><div class="loc">⌖ ${escapeHTML(product.city)} - ${escapeHTML(product.state)}</div></div></a></article>`;
}

function productGrid(items) {
  return items.length
    ? `<div class="product-grid">${items.map(productCard).join("")}</div>`
    : emptyState(
        "Ainda não há anúncios por aqui.",
        "Seja a primeira pessoa a publicar um anúncio.",
      );
}

function searchForm(id, values = {}) {
  return `<form class="search-panel listing-search" id="${id}"><input class="search-input" name="q" value="${escapeHTML(values.q || "")}" placeholder="O que você está procurando?" aria-label="O que você está procurando?"><label class="search-place">⌖ <input name="city" value="${escapeHTML(values.city || "")}" placeholder="Cidade ou região" aria-label="Cidade ou região"></label><button class="btn-primary">Buscar</button></form>`;
}

function home() {
  const recent = products.slice(0, 8);
  return `<section class="hero classifieds-hero"><div class="container hero-grid"><div><span class="eyebrow">Classificados da sua região</span><h1>Encontre o que precisa.<br><em>Venda o que não usa.</em></h1><p class="hero-copy">Anúncios gratuitos para comprar e vender perto de você.</p>${searchForm("home-search")}<a class="btn-primary post-hero" href="/anunciar" data-link>＋ Anunciar grátis</a></div><div class="hero-art"><div class="community-card"><strong>DaBrik</strong><span>Gente da sua região, negociando direto.</span></div></div></div></section>${connectionNotice()}<section class="section"><div class="container"><div class="section-head"><div><span class="section-kicker">Explore</span><h2 class="section-title">Escolha uma categoria</h2></div></div><div class="category-grid classifieds-categories">${categories.map((category) => `<a class="category" data-link href="/produtos?categoria=${encodeURIComponent(category)}"><span class="category-icon">${category === "Automóveis" ? "🚗" : category === "Casa e jardim" ? "🏡" : category === "Celulares e tablets" ? "📱" : category === "Móveis" ? "🪑" : category === "Imóveis" ? "🏠" : category === "Serviços" ? "🧰" : "＋"}</span><span>${escapeHTML(category)}</span></a>`).join("")}</div></div></section><section class="section latest-section"><div class="container"><div class="section-head"><div><span class="section-kicker">Novidades</span><h2 class="section-title">Anúncios recentes</h2></div><a href="/produtos" data-link class="text-link">Ver todos →</a></div>${productGrid(recent)}</div></section>`;
}

function catalog() {
  const params = new URLSearchParams(location.search);
  const query = params.get("q") || "";
  const city = params.get("city") || "";
  const category = params.get("categoria") || "";
  const sort = params.get("sort") || "recent";
  const filtered = products.filter(
    (product) => !category || product.category === category,
  );
  return `${pageTop("Anúncios", "Encontre ofertas de pessoas e negócios da sua região.")}${connectionNotice()}
    <section class="container catalog-page">${searchForm("catalog-search", { q: query, city })}
    <div class="catalog-filters"><label>Categoria <select id="catalog-category"><option value="">Todas</option>${categories.map((item) => `<option ${item === category ? "selected" : ""}>${escapeHTML(item)}</option>`).join("")}</select></label><label>Preço mínimo <input id="catalog-min" type="number" min="0" value="${escapeHTML(params.get("min") || "")}" placeholder="R$ 0"></label><label>Preço máximo <input id="catalog-max" type="number" min="0" value="${escapeHTML(params.get("max") || "")}" placeholder="Sem limite"></label><label>Ordenar por <select id="catalog-sort"><option value="recent" ${sort === "recent" ? "selected" : ""}>Mais recentes</option><option value="low-price" ${sort === "low-price" ? "selected" : ""}>Menor preço</option><option value="high-price" ${sort === "high-price" ? "selected" : ""}>Maior preço</option></select></label><button class="btn-primary" id="filter-button">Filtrar anúncios</button></div>
    <p class="catalog-count" id="result-count">${filtered.length} anúncio${filtered.length === 1 ? "" : "s"}</p><div id="catalog-results">${productGrid(filtered)}</div></section>`;
}

async function detail(id) {
  let product;
  try {
    product = (await api(`/products/${encodeURIComponent(id)}`)).product;
  } catch (error) {
    return `${pageTop("Anúncio indisponível", "Este anúncio pode ter sido removido ou pausado.")}<div class="container"><div class="notice api-notice">${escapeHTML(error.message === "Failed to fetch" ? apiUnavailableMessage() : error.message)}</div>${emptyState("Não foi possível abrir este anúncio.", "Volte aos anúncios e tente novamente.", false)}</div>`;
  }
  const images = product.images?.length
    ? product.images
        .map(
          (image) =>
            `<img src="${escapeHTML(imageUrl(image))}" alt="${escapeHTML(product.title)}">`,
        )
        .join("")
    : '<div class="no-photo detail-no-photo">Anúncio sem foto</div>';
  const mine = token() && product.ownerId === getUser()?.id;
  const phone = product.owner?.phone || "";
  const whatsapp = phone.replace(/\D/g, "").replace(/^55/, "");
  const contact = product.owner?.phone
    ? `<a class="btn-primary wide" target="_blank" rel="noopener noreferrer" href="https://wa.me/55${escapeHTML(whatsapp)}?text=${encodeURIComponent(`Olá! Tenho interesse no anúncio: ${product.title}`)}">Conversar pelo WhatsApp</a><a class="contact-call" href="tel:${escapeHTML(phone.replace(/[^+\d]/g, ""))}">Ligar para ${escapeHTML(product.owner.name)}</a>`
    : '<p class="muted-note">O anunciante não compartilhou um telefone para contato.</p>';
  return `${pageTop("Detalhes do anúncio", `${product.city} - ${product.state}`)}<section class="container listing-detail"><div class="listing-gallery">${images}</div><article class="content-panel listing-description"><span class="section-kicker">${escapeHTML(product.category)}</span><h1>${escapeHTML(product.title)}</h1><p class="listing-location">⌖ ${escapeHTML(product.city)} - ${escapeHTML(product.state)} · Publicado em ${new Date(product.createdAt).toLocaleDateString("pt-BR")}</p><h2>Descrição</h2><p class="description-text">${escapeHTML(product.description).replace(/\n/g, "<br>")}</p><h2>Sobre o anunciante</h2><p>${escapeHTML(product.owner?.name || "Anunciante DaBrik")}</p></article><aside class="detail-aside listing-price"><span class="section-kicker">Preço</span><p class="price">${money(product.price)}</p>${contact}${mine ? `<div class="owner-actions"><a class="account-btn wide" data-link href="/anunciar?editar=${encodeURIComponent(product.id)}">Editar anúncio</a><button class="text-link" data-action="delete" data-id="${escapeHTML(product.id)}">Excluir anúncio</button></div>` : ""}<p class="safety-note">Combine o pagamento e a entrega diretamente com o anunciante. Confira o produto antes de pagar.</p></aside></section>`;
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem("dabrik-user") || "null");
  } catch {
    return null;
  }
}

function authPage(register = false) {
  return `${pageTop(register ? "Criar conta grátis" : "Entrar", register ? "Crie sua conta para publicar e gerenciar anúncios." : "Entre para falar com a comunidade DaBrik.")}<div class="container auth-container"><div class="content-panel"><form id="auth-form" class="form-grid"><div class="field span-2"><label>E-mail</label><input required name="email" type="email" autocomplete="email" placeholder="voce@email.com"></div>${register ? `<div class="field span-2"><label>Seu nome</label><input required name="name" minlength="2" maxlength="100" autocomplete="name" placeholder="Nome e sobrenome"></div><div class="field span-2"><label>WhatsApp com DDD</label><input required name="phone" type="tel" autocomplete="tel" placeholder="(42) 99999-9999"></div>` : ""}<div class="field span-2"><label>Senha</label><input required name="password" type="password" minlength="${register ? 10 : 1}" autocomplete="${register ? "new-password" : "current-password"}" placeholder="${register ? "Pelo menos 10 caracteres" : "Sua senha"}"></div><div class="span-2"><button class="btn-primary wide">${register ? "Criar minha conta" : "Entrar"}</button></div></form><p class="muted-note">${register ? "Já tem conta?" : "Novo por aqui?"} <a class="text-link" data-link href="${register ? "/entrar" : "/cadastro"}">${register ? "Entrar" : "Criar uma conta"}</a></p><div id="auth-error" class="notice" hidden></div></div></div>`;
}

async function listingForm() {
  if (!token()) {
    return `${pageTop("Anuncie grátis", "Entre ou crie sua conta para publicar um anúncio.")}<div class="container">${emptyState("Você precisa entrar primeiro.", "Depois de entrar, seu anúncio fica salvo e pode ser editado por você.", false)}<p class="auth-actions"><a class="btn-primary" data-link href="/cadastro">Criar conta</a><a class="account-btn" data-link href="/entrar">Entrar</a></p></div>`;
  }
  const user = getUser();
  const editingId = new URLSearchParams(location.search).get("editar");
  let product = null;
  if (editingId) {
    const mine = await api("/my/products").catch(() => ({ items: [] }));
    product = mine.items.find((item) => item.id === editingId) || null;
  }
  const value = (key) => escapeHTML(product?.[key] ?? "");
  return `${pageTop(product ? "Editar anúncio" : "Anuncie grátis", "Publique fotos, preço e descrição para pessoas da sua região.")}<section class="container post-container"><div class="content-panel"><form id="listing-form" class="form-grid" data-id="${value("id")}"><div class="field span-2"><label>Título do anúncio</label><input required name="title" minlength="4" maxlength="100" value="${value("title")}" placeholder="Ex.: Bicicleta aro 29 em ótimo estado"></div><div class="field"><label>Categoria</label><select required name="category">${categories.map((category) => `<option ${product?.category === category ? "selected" : ""}>${escapeHTML(category)}</option>`).join("")}</select></div><div class="field"><label>Preço (R$)</label><input required name="price" type="number" min="0" step="0.01" value="${value("price")}" placeholder="0,00"></div><div class="field"><label>Cidade</label><input required name="city" maxlength="80" value="${value("city")}" placeholder="Sua cidade"></div><div class="field"><label>Estado</label><select required name="state">${["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"].map((state) => `<option ${product?.state === state ? "selected" : ""}>${state}</option>`).join("")}</select></div><div class="field span-2"><label>Descrição</label><textarea required name="description" minlength="10" maxlength="3000" placeholder="Conte o estado do produto, medidas e outras informações importantes.">${value("description")}</textarea></div><div class="field span-2"><label>Fotos (até 5, JPG/PNG/WebP)</label><input id="listing-images" name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple><div id="image-preview" class="image-preview">${(product?.images || []).map((image) => `<img src="${escapeHTML(imageUrl(image))}" alt="Foto do anúncio atual">`).join("")}</div><small>Fotos são reduzidas para carregar mais rápido. Cada anúncio aceita até 5.</small></div><label class="consent-check span-2"><input type="checkbox" name="sharePhone" ${product?.sharePhone !== false ? "checked" : ""}> Mostrar meu WhatsApp (${escapeHTML(user?.phone || "")}) neste anúncio para as pessoas interessadas.</label><div class="span-2"><button class="btn-primary">${product ? "Salvar alterações" : "Publicar anúncio grátis"}</button><p id="listing-error" class="notice" hidden></p></div></form></div></section>`;
}

async function accountPage() {
  if (!token())
    return `${pageTop("Minha conta", "Entre para ver seus anúncios.")}<div class="container">${emptyState("Acesse sua conta para continuar.", "Crie e acompanhe seus anúncios em um só lugar.", false)}<p class="auth-actions"><a class="btn-primary" data-link href="/entrar">Entrar</a><a class="account-btn" data-link href="/cadastro">Criar conta</a></p></div>`;
  const result = await api("/my/products").catch((error) => {
    apiProblem =
      error.message === "Failed to fetch" ? apiUnavailableMessage() : error.message;
    return { items: [] };
  });
  const items = result.items || [];
  return `${connectionNotice()}${pageTop("Meus anúncios", "Edite, pause, reative ou marque seus anúncios como vendidos.")}<section class="container account-listings"><div class="section-head"><h2 class="section-title">Olá, ${escapeHTML(getUser()?.name || "anunciante")}</h2><a class="btn-primary" data-link href="/anunciar">＋ Novo anúncio</a></div>${items.length ? `<div class="my-listings">${items.map((product) => `<article class="my-listing"><div class="my-listing-photo">${product.images?.[0] ? `<img src="${escapeHTML(imageUrl(product.images[0]))}" alt="">` : "Sem foto"}</div><div><strong>${escapeHTML(product.title)}</strong><p>${money(product.price)} · ${escapeHTML(product.city)} - ${escapeHTML(product.state)}</p><span class="status-pill ${product.status.toLowerCase()}">${product.status === "ACTIVE" ? "Publicado" : product.status === "PAUSED" ? "Pausado" : "Vendido"}</span></div><div class="my-listing-actions"><a class="text-link" data-link href="/anunciar?editar=${encodeURIComponent(product.id)}">Editar</a><button class="text-link" data-action="status" data-status="${product.status === "ACTIVE" ? "PAUSED" : "ACTIVE"}" data-id="${escapeHTML(product.id)}">${product.status === "ACTIVE" ? "Pausar" : "Reativar"}</button><button class="text-link" data-action="status" data-status="SOLD" data-id="${escapeHTML(product.id)}">Marcar vendido</button><button class="danger-link" data-action="delete" data-id="${escapeHTML(product.id)}">Excluir</button></div></article>`).join("")}</div>` : emptyState("Você ainda não publicou anúncios.", "Publique gratuitamente e encontre compradores na sua região.")}<button id="logout-btn" class="text-link logout-button">Sair da conta</button></section>`;
}

async function render() {
  const path = decodeURI(routePath());
  let html;
  if (path === "/") {
    const result = await loadProducts("/products");
    products = result.items || [];
    html = home();
  } else if (path === "/produtos") {
    const params = new URLSearchParams(location.search);
    const query = new URLSearchParams({
      q: params.get("q") || "",
      city: params.get("city") || "",
      category: params.get("categoria") || "",
      min: params.get("min") || "",
      max: params.get("max") || "",
      sort: params.get("sort") || "recent",
    });
    const result = await loadProducts(`/products?${query}`);
    products = result.items || [];
    html = catalog();
  } else if (path.startsWith("/produto/")) {
    html = await detail(path.split("/")[2]);
  } else if (path === "/anunciar") {
    html = await listingForm();
  } else if (path === "/entrar") {
    html = authPage();
  } else if (path === "/cadastro") {
    html = authPage(true);
  } else if (path === "/conta" || path === "/painel") {
    html = await accountPage();
  } else {
    html = `${pageTop("Página não encontrada", "Volte aos anúncios da sua região.")}<div class="container">${emptyState("Não encontramos essa página.", "Acesse os anúncios e continue procurando.", false)}<p class="auth-actions"><a class="btn-primary" data-link href="/produtos">Ver anúncios</a></p></div>`;
  }
  document.querySelector("#app").innerHTML = html;
  updateAccountButton();
  bindPage();
  window.scrollTo(0, 0);
}

function updateAccountButton() {
  const button = document.querySelector("#account-btn");
  if (button) button.textContent = token() ? "Minha conta" : "Entrar";
}

function navigate(url) {
  history.pushState({}, "", addBasePath(url));
  render();
}

function routePath() {
  const pathname = location.pathname;
  if (BASE_PATH === "/") return pathname || "/";
  if (pathname === BASE_PATH.slice(0, -1)) return "/";
  if (pathname.startsWith(BASE_PATH)) {
    return `/${pathname.slice(BASE_PATH.length)}`;
  }
  return pathname || "/";
}

function addBasePath(url) {
  const target = new URL(url, `${location.origin}${BASE_PATH}`);
  let pathname = target.pathname;
  if (BASE_PATH !== "/" && !pathname.startsWith(BASE_PATH)) {
    pathname = `${BASE_PATH}${pathname.replace(/^\/+/, "")}`;
  }
  return `${pathname}${target.search}${target.hash}`;
}

function routeFromSearch(form) {
  const data = new FormData(form);
  const params = new URLSearchParams();
  if (data.get("q")) params.set("q", data.get("q"));
  if (data.get("city")) params.set("city", data.get("city"));
  navigate(`/produtos${params.size ? `?${params}` : ""}`);
}

async function compressImage(file) {
  if (!file.type.startsWith("image/"))
    throw new Error("Escolha arquivos de imagem.");
  const source = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close();
  let quality = 0.82;
  let blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  // Keep five base64-encoded photos below Vercel's 4.5 MB function request cap.
  while (blob && blob.size > 550_000 && quality > 0.4) {
    quality -= 0.1;
    blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
  }
  if (!blob || blob.size > 600_000)
    throw new Error("Esta foto ficou muito grande. Escolha outra.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () =>
      reject(new Error("Não foi possível ler uma das fotos."));
    reader.readAsDataURL(blob);
  });
}

function bindPage() {
  document.querySelectorAll("#home-search, #catalog-search").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      routeFromSearch(form);
    });
  });

  document
    .querySelector("#filter-button")
    ?.addEventListener("click", async () => {
      const oldParams = new URLSearchParams(location.search);
      const params = new URLSearchParams();
      for (const key of ["q", "city"]) {
        if (oldParams.get(key)) params.set(key, oldParams.get(key));
      }
      const category = document.querySelector("#catalog-category").value;
      if (category) params.set("category", category);
      const min = document.querySelector("#catalog-min").value;
      const max = document.querySelector("#catalog-max").value;
      if (min) params.set("min", min);
      if (max) params.set("max", max);
      params.set("sort", document.querySelector("#catalog-sort").value);
      const result = await api(`/products?${params}`).catch(() => ({
        items: [],
      }));
      const items = result.items || [];
      document.querySelector("#result-count").textContent =
        `${items.length} anúncio${items.length === 1 ? "" : "s"}`;
      document.querySelector("#catalog-results").innerHTML = productGrid(items);
    });

  document
    .querySelector("#auth-form")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const register = location.pathname === "/cadastro";
      const errorBox = document.querySelector("#auth-error");
      const button = form.querySelector("button");
      button.disabled = true;
      try {
        const result = await api(`/auth/${register ? "register" : "login"}`, {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(new FormData(form))),
        });
        localStorage.setItem("dabrik-token", result.token);
        localStorage.setItem("dabrik-user", JSON.stringify(result.user));
        toast(
          register
            ? "Conta criada. Boas-vindas à DaBrik!"
            : "Você entrou na sua conta.",
        );
        navigate("/conta");
      } catch (error) {
        errorBox.hidden = false;
        errorBox.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });

  document
    .querySelector("#listing-images")
    ?.addEventListener("change", (event) => {
      const files = [...event.target.files].slice(0, 5);
      const preview = document.querySelector("#image-preview");
      preview.innerHTML = "";
      files.forEach((file) => {
        const image = document.createElement("img");
        image.alt = "Prévia da foto";
        image.src = URL.createObjectURL(file);
        preview.appendChild(image);
      });
      if (event.target.files.length > 5) toast("Você pode enviar até 5 fotos.");
    });

  document
    .querySelector("#listing-form")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const errorBox = document.querySelector("#listing-error");
      const button = form.querySelector("button");
      button.disabled = true;
      try {
        const data = Object.fromEntries(new FormData(form));
        const files = [
          ...document.querySelector("#listing-images").files,
        ].slice(0, 5);
        data.images = await Promise.all(files.map(compressImage));
        data.price = Number(data.price);
        data.sharePhone = new FormData(form).has("sharePhone");
        const id = form.dataset.id;
        const result = await api(
          id ? `/products/${encodeURIComponent(id)}` : "/products",
          {
            method: id ? "PUT" : "POST",
            body: JSON.stringify(data),
          },
        );
        toast(id ? "Anúncio atualizado." : "Anúncio publicado com sucesso!");
        navigate(`/produto/${encodeURIComponent(result.product.id)}`);
      } catch (error) {
        errorBox.hidden = false;
        errorBox.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });

  document.querySelector("#logout-btn")?.addEventListener("click", () => {
    localStorage.removeItem("dabrik-token");
    localStorage.removeItem("dabrik-user");
    toast("Você saiu da sua conta.");
    navigate("/");
  });

  document.querySelectorAll('[data-action="status"]').forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api(`/products/${encodeURIComponent(button.dataset.id)}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: button.dataset.status }),
        });
        toast("Status do anúncio atualizado.");
        render();
      } catch (error) {
        toast(error.message);
      }
    });
  });

  document.querySelectorAll('[data-action="delete"]').forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("Excluir este anúncio permanentemente?")) return;
      try {
        await api(`/products/${encodeURIComponent(button.dataset.id)}`, {
          method: "DELETE",
        });
        toast("Anúncio excluído.");
        navigate("/conta");
      } catch (error) {
        toast(error.message);
      }
    });
  });

  document
    .querySelector("#account-btn")
    ?.addEventListener("click", () => navigate(token() ? "/conta" : "/entrar"));
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-link]");
  if (!link) return;
  const target = new URL(link.href);
  if (target.origin !== location.origin) return;
  event.preventDefault();
  navigate(`${target.pathname}${target.search}`);
  document.querySelector(".mobile-nav")?.classList.remove("open");
});

document.querySelector("#menu-toggle")?.addEventListener("click", () => {
  let nav = document.querySelector(".mobile-nav");
  if (!nav) {
    nav = document.createElement("nav");
    nav.className = "mobile-nav";
    nav.innerHTML =
      '<a href="/produtos" data-link>Anúncios</a><a href="/anunciar" data-link>Anunciar grátis</a><a href="/conta" data-link>Meus anúncios</a>';
    document.body.appendChild(nav);
  }
  nav.classList.toggle("open");
});

window.addEventListener("popstate", render);
render();
