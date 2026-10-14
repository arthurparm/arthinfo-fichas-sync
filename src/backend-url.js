// URL do backend (arthinfo-fichas-api), embutida no build (FDD-73): o usuário não a
// define. A produção é o padrão; `vite` em modo de desenvolvimento aponta pra
// localhost:3000, e BACKEND_URL=... no `npm run build` troca a URL (ex.: quando
// houver domínio próprio ou pra quem hospeda o próprio backend e recompila).
export const PRODUCTION_BACKEND_URL = 'https://arthinfo-api.arthur-paraiso-mar.workers.dev';

// eslint-disable-next-line no-undef
export const BACKEND_URL = typeof __BACKEND_URL__ === 'string' ? __BACKEND_URL__ : PRODUCTION_BACKEND_URL;
