#!/usr/bin/env node
/**
 * Monta o preview do orçamento embutindo tudo num arquivo só.
 *
 * O preview roda o MESMO codigo.gs que o Apps Script executa — não é uma
 * maquete com números digitados. Se o motor mudar, o preview muda junto.
 *
 * As fontes e o logo precisam estar embutidos como data URI porque o CSP dos
 * artifacts bloqueia qualquer requisição a host externo.
 *
 *   node preview/build.js [caminho-de-saida]
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const saida = process.argv[2] || path.join(__dirname, 'orcamento-preview.html');

/** Fontes e logo da marca, versionados aqui para o build ser autossuficiente. */
const MARCA = process.env.FINI_MARCA || path.join(__dirname, 'marca');

const ativos = {
  __FONT_NUNITO_REGULAR__: 'Nunito-Regular.ttf',
  __FONT_NUNITO_BOLD__: 'Nunito-Bold.ttf',
  __FONT_FINIFUN__: 'FiniFun.otf'
};

let html = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');

for (const [marcador, arquivo] of Object.entries(ativos)) {
  const caminho = path.join(MARCA, arquivo);
  if (!fs.existsSync(caminho)) {
    console.error(`Faltando: ${caminho}\nAponte FINI_MARCA para a pasta com as fontes da marca.`);
    process.exit(1);
  }
  html = html.replace(marcador, fs.readFileSync(caminho).toString('base64'));
}

const logo = path.join(MARCA, 'FINI-SLOGANBRANCO.png');
html = html.replace('__LOGO_FINI__', 'data:image/png;base64,' + fs.readFileSync(logo).toString('base64'));

const motor = fs.readFileSync(path.join(RAIZ, 'codigo.gs'), 'utf8');
if (motor.includes('</script')) {
  console.error('codigo.gs contém "</script" e quebraria a página. Abortando.');
  process.exit(1);
}
html = html.replace('__MOTOR__', () => motor);

const pendentes = html.match(/__[A-Z_]+__/g);
if (pendentes) {
  console.error('Marcadores não substituídos: ' + pendentes.join(', '));
  process.exit(1);
}

fs.mkdirSync(path.dirname(saida), { recursive: true });
fs.writeFileSync(saida, html);
console.log(`${saida} · ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB`);
