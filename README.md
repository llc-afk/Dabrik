# DaBrik

Classificados para comprar e vender produtos na sua região. O backend Express existente oferece armazenamento local em desenvolvimento e Neon PostgreSQL + Vercel Blob em produção, preservando a API usada pelo frontend.

## Abrir o site

Requisitos: Node.js 20 ou mais recente.

```sh
cd ~/dabrik
npm install
npm run dev
```

Abra `http://localhost:3000`. Deixe o Terminal aberto enquanto usa o site. Para fechar, pressione `Ctrl+C`. Para abrir em outro dia, repita `cd ~/dabrik` e `npm run dev`.

## Armazenamento atual e rotas

Sem `DATABASE_URL`, o modo local lê e grava usuários e anúncios em `data/marketplace.json` e grava as fotos em `uploads/`. Esses arquivos continuam sendo usados no desenvolvimento e não são apagados pela migração.

Com `DATABASE_URL`, o backend usa PostgreSQL. As tabelas são criadas automaticamente se não existirem:

- `users`: id, nome, e-mail único, telefone, hash da senha e data de criação.
- `products`: dono, título, descrição, categoria, preço, cidade, estado, URLs das imagens (array ordenado), compartilhamento de telefone, status e data.

Não há favoritos, pedidos ou transações implementados no projeto. As fotos de novos anúncios são validadas pelo backend e enviadas para a store privada do Vercel Blob; a API salva suas URLs no campo `products.images`. Para exibir fotos de anúncios, `GET /api/blob` valida os caminhos DaBrik e transmite a imagem sem expor o token da store. O frontend continua recebendo e enviando o mesmo campo `images`.

Rotas existentes que leem ou escrevem os dados:

- `GET /api/health`, `GET /api/products`, `GET /api/products/:id`, `GET /api/categories` leem dados/categorias.
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` tratam contas e autenticação.
- `GET /api/my/products` lista anúncios da conta.
- `POST /api/products`, `PUT /api/products/:id`, `PATCH /api/products/:id/status`, `DELETE /api/products/:id` criam, atualizam e removem anúncios e fotos.
- `/uploads/*` continua servindo fotos locais no modo local. Fotos já públicas no Blob continuam usando suas URLs; imagens da store privada são transmitidas por `/api/blob`.

## O que já funciona

- Criar conta e entrar com e-mail e senha.
- Publicar anúncios gratuitos com título, descrição, categoria, preço, cidade e até 5 fotos.
- Buscar anúncios por texto e cidade; filtrar por categoria e faixa de preço.
- Abrir um anúncio e conversar com o anunciante pelo WhatsApp, se ele optar por compartilhar o número.
- Ver, editar, pausar, reativar, marcar como vendido e excluir os próprios anúncios.
- Usar o layout no celular e no computador.

Não há produtos ou contas de demonstração. O catálogo local contém apenas os dados reais que já existem. Senhas são armazenadas com hash. Faça uma cópia de `data/marketplace.json` e de `uploads/` antes de migrar; o script não apaga nem altera os originais.

## Onde mudar

- `frontend/index.html`: cabeçalho, navegação e rodapé.
- `frontend/styles.css`: cores, aparência e adaptação para celular.
- `frontend/app.js`: telas, formulários, buscas e interações.
- `backend/src/server.js`: cadastro, login, anúncios, fotos e armazenamento local.

As categorias estão no começo de `backend/src/server.js` e também no começo de `frontend/app.js`; mantenha as duas listas iguais ao alterá-las.

## Produção: Neon PostgreSQL + Vercel Blob

Não existe integração Supabase ou outro banco/storage neste projeto. A implementação usa Neon por conexão PostgreSQL padrão (`pg`) e Vercel Blob para arquivos; a URL da conexão Neon deve ser a variante pooled para reduzir conexões de Functions serverless. A API não cria outra aplicação nem altera os endpoints.

Cadastre estas variáveis na Vercel (**Settings → Environment Variables**, Production e Preview conforme necessário):

- `NODE_ENV=production`
- `DATABASE_URL`: connection string PostgreSQL pooled do Neon.
- `BLOB_READ_WRITE_TOKEN`: token do store Vercel Blob conectado ao projeto.
- `JWT_SECRET`: segredo aleatório com pelo menos 32 caracteres.
- `CORS_ORIGIN=https://llc-afk.github.io,http://localhost:3000,http://127.0.0.1:3000`
- `PG_POOL_MAX=5` (opcional; padrão 5).

O código não contém segredos. `.env` está ignorado pelo Git; use `.env.example` como referência. Em **GitHub → Settings → Secrets and variables → Actions → Variables**, defina separadamente `DABRIK_API_BASE_URL` como origem pública HTTPS da API (sem `/api`). Ela é pública e o workflow Pages já a injeta no frontend.

### Migração segura dos arquivos atuais

1. Faça cópia de segurança de `data/marketplace.json` e de todos os arquivos em `uploads/`.
2. Crie a base PostgreSQL no Neon e conecte/crie um store Vercel Blob no mesmo projeto. Obtenha a connection string pooled e o token de escrita.
3. Crie um `.env` local não versionado com `DATABASE_URL` e `BLOB_READ_WRITE_TOKEN`.
4. Rode `npm ci` e depois `npm run migrate:legacy`. O comando cria as tabelas, insere usuários/anúncios sem sobrescrever IDs já existentes e move fotos para o Blob com nomes determinísticos. Pode ser repetido: não remove nem modifica JSON/fotos locais. Confira os totais exibidos antes de trocar a API para produção.
5. Cadastre as variáveis listadas na Vercel. `GET /api/health` deve informar `database: "postgresql"` após o deploy.

O script espera que IDs e relações no JSON sejam válidos. Se encontrar foto local ausente, URL não suportada ou conflito de integridade, para com erro e mantém as fontes originais; corrija a origem e rode novamente. As fotos do Blob são públicas, apropriadas para fotos de anúncios que já são públicas.

O frontend reduz cada foto para até 600 KB e a API aceita requisições JSON de até 4,2 MB para ficar abaixo do limite de 4,5 MB por requisição de Function na Vercel.

Para deploy posterior, importe o repositório na Vercel com a raiz do projeto como **Root Directory** e Node.js; `vercel` cria preview e `vercel --prod` publica produção. O `vercel.json` encaminha ao Express atual. Após o deploy, configure `DABRIK_API_BASE_URL` nas Actions Variables do GitHub e execute o workflow do Pages. Este trabalho não executou deploy.

Cadastro não confirma a identidade do usuário por e-mail ou SMS. Antes de anunciar para o público, adicione verificação de contato e moderação contra spam e anúncios impróprios.

Não publique `.env`, `data/`, `uploads/` nem dados pessoais no repositório.

## GitHub Pages

O workflow `.github/workflows/pages.yml` publica somente o conteúdo de `frontend/` no endereço `https://llc-afk.github.io/Dabrik/`. Nas configurações do repositório, abra **Settings → Pages** e selecione **GitHub Actions** como origem de publicação.

O GitHub Pages serve apenas o frontend. Para ligar cadastro/login/anúncios à API na Vercel, siga o procedimento de produção e configure `DABRIK_API_BASE_URL` conforme acima.

Sem uma URL de API configurada, o frontend publicado exibe uma mensagem de backend desconectado; ele não simula anúncios ou contas. O uso local continua usando `http://localhost:3000` e a API local.

## Área do vendedor, carrinho, denúncias e mensagens

Esta cópia de teste inclui:

- **Área do vendedor** em `/vendedor`, com anúncios e conversas recentes.
- **Denúncia de anúncios**, disponível na página de cada produto para usuários autenticados.
- **Carrinho** em `/carrinho`, salvo no navegador. Ele calcula um subtotal estimado; pagamento e entrega são combinados com o vendedor.
- **Mensagens privadas** entre comprador e vendedor em `/mensagens`. As conversas são restritas às duas contas participantes.

As tabelas `product_reports`, `conversations` e `messages` são criadas automaticamente no PostgreSQL já configurado no projeto. Para o modo local sem `DATABASE_URL`, essas novas informações ficam no arquivo local da cópia.

## Notificações push de mensagens (OneSignal)

O frontend registra o navegador no OneSignal após a pessoa clicar em **Ativar neste navegador** na Área do vendedor. O usuário é associado ao `user.id` existente da DaBrik como External ID. Quando uma mensagem nova é gravada, o backend envia uma notificação privada ao outro participante da conversa. O conteúdo da mensagem não é incluído na notificação.

Para habilitar em produção:

1. No OneSignal, configure uma aplicação **Web Push** com integração **Custom Code** e Site URL igual à origem do frontend, `https://llc-afk.github.io`.
2. O App ID público e o Safari Web ID enviados no snippet já estão configurados no frontend e no workflow do GitHub Pages. Se trocar a aplicação OneSignal, atualize esses dois valores em `frontend/config.js` e `.github/workflows/pages.yml` (ou defina a variável opcional `ONESIGNAL_APP_ID` no GitHub Actions).
3. Cadastre `ONESIGNAL_APP_ID=46bd790b-9f2c-4932-86d0-7a4a0a942275`, `ONESIGNAL_REST_API_KEY` (como segredo) e `DABRIK_SITE_URL=https://llc-afk.github.io/Dabrik/` nas variáveis da Vercel.
4. O service worker fica em `frontend/OneSignalSDKWorker.js`; na configuração Custom Code o SDK registra esse arquivo no escopo `/Dabrik/` no GitHub Pages e `/` no domínio raiz da Vercel. Não configure outro caminho de worker no painel OneSignal.
5. Publique o frontend e o backend. A pessoa deve entrar na conta, abrir a Área do vendedor e ativar as notificações no navegador. O navegador exibirá seu próprio pedido de permissão.

Web Push exige HTTPS (localhost é aceito para desenvolvimento), permissão concedida e assinatura no dispositivo. Uma aplicação OneSignal corresponde a uma origem; se a DaBrik também enviar notificações por um domínio próprio diferente do GitHub Pages, configure outra aplicação Web Push para esse domínio.

Para abrir localmente, instale as dependências com `npm ci` e rode `npm run dev`. A cópia foi criada sem credenciais, banco JSON de produção ou uploads do projeto original.
