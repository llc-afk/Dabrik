# DaBrik

Classificados para comprar e vender produtos na sua região. O fluxo principal funciona sem PostgreSQL: contas, anúncios e fotos ficam salvos neste computador.

## Abrir o site

Requisitos: Node.js 20 ou mais recente.

```sh
cd ~/dabrik
npm install
npm run dev
```

Abra `http://localhost:3000`. Deixe o Terminal aberto enquanto usa o site. Para fechar, pressione `Ctrl+C`. Para abrir em outro dia, repita `cd ~/dabrik` e `npm run dev`.

## O que já funciona

- Criar conta e entrar com e-mail e senha.
- Publicar anúncios gratuitos com título, descrição, categoria, preço, cidade e até 5 fotos.
- Buscar anúncios por texto e cidade; filtrar por categoria e faixa de preço.
- Abrir um anúncio e conversar com o anunciante pelo WhatsApp, se ele optar por compartilhar o número.
- Ver, editar, pausar, reativar, marcar como vendido e excluir os próprios anúncios.
- Usar o layout no celular e no computador.

Não há produtos ou contas de demonstração. O catálogo começa vazio. As senhas são armazenadas como hash; os dados ficam em `data/marketplace.json`, com acesso restrito ao usuário do computador, e as fotos em `uploads/`. Faça cópias de segurança dessas pastas se publicar anúncios que não queira perder.

## Onde mudar

- `frontend/index.html`: cabeçalho, navegação e rodapé.
- `frontend/styles.css`: cores, aparência e adaptação para celular.
- `frontend/app.js`: telas, formulários, buscas e interações.
- `backend/src/server.js`: cadastro, login, anúncios, fotos e armazenamento local.

As categorias estão no começo de `backend/src/server.js` e também no começo de `frontend/app.js`; mantenha as duas listas iguais ao alterá-las.

## Uso público na internet

Esta versão salva os dados em arquivos locais e funciona em uma única instância persistente do Node.js. Para receber anúncios pela internet, hospede o app em um servidor Node com disco persistente e HTTPS, e configure `NODE_ENV=production` e uma chave `JWT_SECRET` aleatória. Não use hospedagem que apague `data/` ou `uploads/` a cada reinício. Para rodar várias instâncias, será preciso migrar esses arquivos para um banco e um armazenamento compartilhado de fotos. O código não processa pagamentos nem tem chat interno: comprador e anunciante conversam pelo WhatsApp quando o anunciante autoriza o compartilhamento do número.

Cadastro não confirma a identidade do usuário por e-mail ou SMS. Antes de anunciar para o público, adicione verificação de contato e moderação contra spam e anúncios impróprios.

Em produção, configure `NODE_ENV=production` e `JWT_SECRET` com uma chave aleatória longa. Não publique `.env`, `data/` ou dados pessoais no repositório.
