#!/usr/bin/env node
/**
 * Roda os casos de aceite de casos.json contra o motor de codigo.gs.
 *
 * O motor não depende de nenhuma API do Google no núcleo de cálculo, então dá
 * para carregá-lo aqui como texto e executá-lo em Node — permitindo verificar
 * as contas antes de subir qualquer coisa para o Apps Script.
 *
 *   node testes/runner.js
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const fonte = fs.readFileSync(path.join(RAIZ, 'codigo.gs'), 'utf8');
const suite = JSON.parse(fs.readFileSync(path.join(__dirname, 'casos.json'), 'utf8'));

const motor = new Function(
  fonte + '\nreturn { orcar, orcarOpcoes, orcarAcao, formatarWhatsApp, precoMinimo_, kgMaximo_, carregarConfig_ };'
)();

const cfg = motor.carregarConfig_();
const TOL = suite.tolerancia || 0.005;

function buscar(obj, caminho) {
  return caminho.split('.').reduce(
    (o, k) => (o === null || o === undefined ? undefined : o[k]),
    obj
  );
}

function iguais(obtido, esperado) {
  if (typeof esperado === 'number' && typeof obtido === 'number') {
    return Math.abs(obtido - esperado) <= TOL;
  }
  return obtido === esperado;
}

function formatar(v) {
  if (v === undefined) return '(ausente)';
  if (typeof v === 'number') return v.toFixed(2);
  return JSON.stringify(v);
}

function executar(caso) {
  const e = caso.entrada;
  switch (caso.acao) {
    case 'orcar':
      return motor.orcar(e, cfg);
    case 'orcarOpcoes':
      return motor.orcarOpcoes(e, cfg);
    case 'orcarAcao':
      return motor.orcarAcao(e.eventos, e.opcoes, cfg);
    case 'precoMinimo':
      return motor.precoMinimo_(e.liquido_alvo, e.kg, e.frete, e.promotor, e.comissao, cfg);
    case 'kgMaximo':
      return motor.kgMaximo_(e.budget, e.liquido_alvo, e.frete, e.promotor, e.comissao, cfg);
    default:
      return null;
  }
}

/** O total tem de crescer com o kg — a interpolação da taxa pode inverter isso. */
function verificarMonotonia(caso) {
  const e = caso.entrada;
  const falhas = [];
  let anterior = null;
  for (let kg = e.de; kg <= e.ate + 1e-9; kg += e.passo) {
    const r = motor.orcar({ local: e.local, kg: Number(kg.toFixed(2)) }, cfg);
    if (!r.ok) { falhas.push(`${kg} kg não calculou`); continue; }
    const total = r.publico.total_geral;
    if (anterior !== null && total < anterior.total - 1e-9) {
      falhas.push(`${kg} kg custa ${total.toFixed(2)}, menos que ${anterior.kg} kg (${anterior.total.toFixed(2)})`);
    }
    anterior = { kg, total };
  }
  return falhas;
}

const PROIBIDOS = ['custo', 'imposto', 'liquido', 'líquido', 'piso', 'margem', 'comissao', 'comissão'];

/** Nada de custo, imposto, líquido ou piso pode escapar para o bloco do cliente. */
function verificarVazamento(caso) {
  const r = motor.orcar(caso.entrada, cfg);
  if (!r.ok) return ['orçamento não calculou'];
  const texto = JSON.stringify(r.publico).toLowerCase();
  return PROIBIDOS.filter((p) => texto.includes(p)).map((p) => `"${p}" apareceu no bloco público`);
}

/**
 * O mesmo invariante, aplicado à string que de fato vai para a cliente pelo
 * WhatsApp. O bloco `publico` estar limpo não basta se a formatação vazar.
 */
function verificarWhatsApp(caso) {
  const r = motor.orcarOpcoes(caso.entrada, cfg);
  if (!r.ok) return [`orçamento não calculou: ${r.pergunta || (r.faltando || []).join(', ')}`];

  const { texto_cliente, texto_interno } = motor.formatarWhatsApp(r, cfg);
  const erros = [];

  const minusculo = texto_cliente.toLowerCase();
  PROIBIDOS.forEach((p) => {
    if (minusculo.includes(p)) erros.push(`"${p}" vazou para o texto da cliente`);
  });

  (caso.contemCliente || []).forEach((t) => {
    if (!texto_cliente.includes(t)) erros.push(`texto da cliente não traz "${t}"`);
  });
  (caso.contemInterno || []).forEach((t) => {
    if (!texto_interno.includes(t)) erros.push(`bloco interno não traz "${t}"`);
  });

  if (caso.mostrarTexto) {
    console.log('\n' + texto_cliente + '\n\n---\n\n' + texto_interno + '\n');
  }
  return erros;
}

let passou = 0;
const falhados = [];
let grupoAtual = null;

console.log('\n  Motor de Orçamento · Fini Carrinhos');
console.log('  ' + '='.repeat(62));

for (const caso of suite.casos) {
  if (caso.grupo !== grupoAtual) {
    grupoAtual = caso.grupo;
    console.log(`\n  ${grupoAtual}`);
    console.log('  ' + '-'.repeat(62));
  }

  let erros = [];

  if (caso.acao === 'monotonia') {
    erros = verificarMonotonia(caso);
  } else if (caso.acao === 'vazamento') {
    erros = verificarVazamento(caso);
  } else if (caso.acao === 'whatsapp') {
    erros = verificarWhatsApp(caso);
  } else {
    const resultado = executar(caso);
    for (const [caminho, esperado] of Object.entries(caso.espera || {})) {
      const obtido = buscar(resultado, caminho);
      if (!iguais(obtido, esperado)) {
        erros.push(`${caminho}: esperado ${formatar(esperado)}, obtido ${formatar(obtido)}`);
      }
    }
    if (caso.esperaAviso) {
      const avisos = (resultado.interno && resultado.interno.avisos) || resultado.avisos || [];
      if (!avisos.some((a) => a.includes(caso.esperaAviso))) {
        erros.push(`nenhum aviso contendo "${caso.esperaAviso}" (avisos: ${JSON.stringify(avisos)})`);
      }
    }
  }

  if (erros.length === 0) {
    passou++;
    console.log(`  ok   ${caso.id}`);
  } else {
    falhados.push({ caso, erros });
    console.log(`  FALHA ${caso.id}`);
    erros.forEach((e) => console.log(`         ${e}`));
  }
}

console.log('\n  ' + '='.repeat(62));
console.log(`  ${passou}/${suite.casos.length} casos passaram`);
if (falhados.length) {
  console.log(`  ${falhados.length} FALHARAM\n`);
  process.exit(1);
}
console.log('  Motor validado contra as apresentações reais e a spec.\n');
