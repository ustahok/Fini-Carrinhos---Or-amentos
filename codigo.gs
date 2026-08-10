/**
 * Fini Carrinhos · Agente de Orçamento
 * Motor de cálculo determinístico.
 *
 * PRINCÍPIO INEGOCIÁVEL: nenhum valor deste arquivo vem de IA. O modelo apenas
 * extrai parâmetros do texto livre; tudo aqui é aritmética sobre a planilha de
 * parâmetros. Se um parâmetro obrigatório faltar, o motor devolve `faltando` —
 * nunca inventa.
 *
 * Regras de negócio: ver spec.md. Estrutura da planilha: ver parametros-planilha.md.
 *
 * O núcleo de cálculo não usa nenhuma API do Google, de propósito: assim ele roda
 * igual no Apps Script e no Node (testes/runner.js).
 */

// ---------------------------------------------------------------------------
// Padrões embutidos. A planilha sobrescreve tudo isto; existem para o motor
// funcionar (e ser testável) antes da planilha estar montada.
// ---------------------------------------------------------------------------

var PADRAO = {
  custo_kg: 31.68,
  aliquota_imposto: 0.085,
  promotor_base: 150,
  promotor_hora_extra: 50,
  promotor_madrugada: 100,
  duracao_padrao_h: 4,
  parcelas: 3,
  piso_semana_min: 500,
  piso_semana_max: 600,
  piso_padrao_min: 700,
  piso_padrao_max: 1000,
  g_por_convidado_default: 80,
  comissao_default: 0
};

/** Âncoras de preço por kg. Entre âncoras, interpola-se a TAXA (nunca o total). */
var PRECO_KG_PADRAO = [
  { kg: 12, preco: 135 },
  { kg: 15, preco: 128 },
  { kg: 16, preco: 127.5 },
  { kg: 18, preco: 125 },
  { kg: 20, preco: 125 }
];

/**
 * Frete por região. A ordem importa: o primeiro alias que casar vence, então as
 * regiões específicas vêm antes de "São Paulo" (um endereço em Santo André
 * costuma conter "São Paulo" também).
 * `arbitra: false` = o agente não decide o valor, pergunta ao operador.
 */
var FRETE_PADRAO = [
  { regiao: 'ABC', valor: 200, arbitra: true,
    aliases: ['abc', 'santo andre', 'sao bernardo', 'sao caetano', 'diadema',
              'maua', 'ribeirao pires', 'rio grande da serra'] },
  { regiao: 'Osasco', valor: 250, arbitra: true, aliases: ['osasco'] },
  { regiao: 'Guarulhos', valor: 250, arbitra: true, aliases: ['guarulhos'] },
  { regiao: 'São Paulo', valor: 150, arbitra: true,
    aliases: ['sao paulo', 'capital', 'sp'] }
];

/** Escada curada convidados → 3 opções de kg. Não é fórmula (spec §4). */
var ESCADA_PADRAO = [
  { convidados: 50,  opcoes: [8, 8.5, 9] },
  { convidados: 60,  opcoes: [8, 8.5, 9] },
  { convidados: 70,  opcoes: [8.5, 9, 10.5] },
  { convidados: 80,  opcoes: [9, 10.5, 11.5] },
  { convidados: 90,  opcoes: [9, 10.5, 11.5] },
  { convidados: 100, opcoes: [10.5, 11.5, 12] },
  { convidados: 120, opcoes: [11.5, 12, 16] },
  { convidados: 150, opcoes: [15, 16, 18] },
  { convidados: 200, opcoes: [15, 16, 20] }
];

/**
 * Composições publicadas nas apresentações. São DEFAULTS de apresentação, não
 * restrições: o cliente pode pedir qualquer combinação e o peso é redistribuído
 * (spec §3). Não existe a regra `kg = baleiros - 0,5 × marshmallows`.
 */
var COMPOSICAO_PADRAO = [
  { kg: 8,    balas: 7,  marshmallows: 2, baleiros: 9 },
  { kg: 8.5,  balas: 8,  marshmallows: 1, baleiros: 9 },
  { kg: 9,    balas: 9,  marshmallows: 0, baleiros: 9 },
  { kg: 10.5, balas: 9,  marshmallows: 3, baleiros: 12 },
  { kg: 11.5, balas: 11, marshmallows: 1, baleiros: 12 },
  { kg: 12,   balas: 12, marshmallows: 0, baleiros: 12 },
  { kg: 15,   balas: 12, marshmallows: 0, baleiros: 12 },
  { kg: 16,   balas: 14, marshmallows: 4, baleiros: 18 },
  { kg: 18,   balas: 18, marshmallows: 0, baleiros: 18 },
  { kg: 20,   balas: 18, marshmallows: 0, baleiros: 18 }
];

var PESO_MARSHMALLOW = 0.5;   // kg fixos por opção de marshmallow (spec §3)
var PASSO_BALEIRO = 0.5;      // granularidade da distribuição de peso

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

function arredondar_(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** 1380.5 -> "1.380,50". Formato brasileiro, para os textos que o cliente lê. */
function formatarReais_(v) {
  var n = arredondar_(Math.abs(v)).toFixed(2).split('.');
  return n[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + n[1];
}

function normalizar_(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Aceita 12.5, "12,5", "R$ 1.380,00". Devolve null se não for número. */
function paraNumero_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  var s = String(v).replace(/r\$/i, '').trim();
  if (s.indexOf(',') > -1) s = s.replace(/\./g, '').replace(',', '.');
  s = s.replace(/[^0-9.\-]/g, '');
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/** "HH:MM" -> minutos desde meia-noite. */
function paraMinutos_(hora) {
  if (!hora) return null;
  var m = String(hora).match(/^(\d{1,2})[:h]?(\d{2})?/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
}

// ---------------------------------------------------------------------------
// Preço por kg (spec §5.1)
// ---------------------------------------------------------------------------

/**
 * Interpolação linear sobre a TAXA entre âncoras. Abaixo da primeira âncora a
 * taxa é a da primeira; acima da última, a da última.
 */
function precoKg_(kg, ancoras) {
  var a = (ancoras || PRECO_KG_PADRAO).slice().sort(function (x, y) { return x.kg - y.kg; });
  if (kg <= a[0].kg) return a[0].preco;
  if (kg >= a[a.length - 1].kg) return a[a.length - 1].preco;
  for (var i = 0; i < a.length - 1; i++) {
    if (kg >= a[i].kg && kg <= a[i + 1].kg) {
      var t = (kg - a[i].kg) / (a[i + 1].kg - a[i].kg);
      return a[i].preco + t * (a[i + 1].preco - a[i].preco);
    }
  }
  return a[a.length - 1].preco;
}

// ---------------------------------------------------------------------------
// Frete (spec §5.2)
// ---------------------------------------------------------------------------

/**
 * Devolve { regiao, valor, consultar }. `consultar: true` significa que o agente
 * NÃO arbitra: precisa perguntar o valor ao operador antes de emitir.
 */
function frete_(local, tabela) {
  var t = tabela || FRETE_PADRAO;
  var alvo = normalizar_(local);
  if (!alvo) return { regiao: null, valor: null, consultar: true, motivo: 'local não informado' };
  for (var i = 0; i < t.length; i++) {
    var linha = t[i];
    var aliases = linha.aliases || [normalizar_(linha.regiao)];
    for (var j = 0; j < aliases.length; j++) {
      if (alvo.indexOf(normalizar_(aliases[j])) > -1) {
        if (linha.arbitra === false) {
          return { regiao: linha.regiao, valor: null, consultar: true, motivo: 'região fora das faixas' };
        }
        return { regiao: linha.regiao, valor: linha.valor, consultar: false };
      }
    }
  }
  return { regiao: null, valor: null, consultar: true, motivo: 'região fora das faixas' };
}

// ---------------------------------------------------------------------------
// Promotor (spec §5.3)
// ---------------------------------------------------------------------------

/** Qualquer parte do evento após 00:00 dispara madrugada. */
function ehMadrugada_(horaInicio, horaFim) {
  var ini = paraMinutos_(horaInicio);
  var fim = paraMinutos_(horaFim);
  if (ini === null && fim === null) return false;
  if (ini !== null && fim !== null && fim < ini) return true;  // atravessa a meia-noite
  var LIMITE = 5 * 60;                                          // 00:00–05:00 é madrugada
  if (ini !== null && ini < LIMITE) return true;
  if (fim !== null && fim > 0 && fim <= LIMITE) return true;
  return false;
}

/** Duração em horas. Sem horários informados, usa a duração padrão. */
function duracaoHoras_(horaInicio, horaFim, cfg) {
  var ini = paraMinutos_(horaInicio);
  var fim = paraMinutos_(horaFim);
  if (ini === null || fim === null) return cfg.duracao_padrao_h;
  var diff = fim - ini;
  if (diff <= 0) diff += 24 * 60;
  return diff / 60;
}

function promotor_(horas, madrugada, cfg) {
  var extras = Math.max(0, horas - cfg.duracao_padrao_h);
  return cfg.promotor_base
    + cfg.promotor_hora_extra * extras
    + (madrugada ? cfg.promotor_madrugada : 0);
}

// ---------------------------------------------------------------------------
// Convidados → kg (spec §4)
// ---------------------------------------------------------------------------

/**
 * Devolve { opcoes[], kg (opção do meio), fora_da_escada, faixa_usada, aviso }.
 * Dentro da tabela: lookup direto. Entre faixas: encaixa na mais próxima e avisa.
 * Acima da última faixa: calcula por g/convidado e avisa (decisão do Will).
 */
function kgPorConvidados_(convidados, escada, cfg) {
  var e = (escada || ESCADA_PADRAO).slice().sort(function (a, b) { return a.convidados - b.convidados; });
  var maiorFaixa = e[e.length - 1];

  for (var i = 0; i < e.length; i++) {
    if (e[i].convidados === convidados) {
      return {
        opcoes: e[i].opcoes.slice(),
        kg: e[i].opcoes[1],
        fora_da_escada: false,
        faixa_usada: e[i].convidados,
        aviso: null
      };
    }
  }

  if (convidados > maiorFaixa.convidados) {
    var g = cfg.g_por_convidado_default;
    var kg = arredondar_(convidados * g / 1000);
    return {
      opcoes: [kg],
      kg: kg,
      fora_da_escada: true,
      faixa_usada: null,
      aviso: 'Acima de ' + maiorFaixa.convidados + ' convidados: kg calculado a ' +
             g + ' g/convidado. Confira antes de enviar.'
    };
  }

  var maisProxima = e[0];
  for (var k = 0; k < e.length; k++) {
    if (Math.abs(e[k].convidados - convidados) < Math.abs(maisProxima.convidados - convidados)) {
      maisProxima = e[k];
    }
  }
  return {
    opcoes: maisProxima.opcoes.slice(),
    kg: maisProxima.opcoes[1],
    fora_da_escada: false,
    faixa_usada: maisProxima.convidados,
    aviso: convidados + ' convidados não está na tabela; usei a faixa de ' +
           maisProxima.convidados + '.'
  };
}

// ---------------------------------------------------------------------------
// Composição de baleiros (spec §3 e §4.1)
// ---------------------------------------------------------------------------

function composicaoPadrao_(kg, tabela) {
  var t = tabela || COMPOSICAO_PADRAO;
  for (var i = 0; i < t.length; i++) {
    if (Math.abs(t[i].kg - kg) < 1e-9) return t[i];
  }
  var baleiros = kg <= 9 ? 9 : (kg <= 15 ? 12 : 18);
  return { kg: kg, balas: baleiros, marshmallows: 0, baleiros: baleiros };
}

/**
 * Distribui o kg contratado entre as opções. Marshmallow é sempre 0,5 kg; o
 * restante é dividido entre as balas em passos de 0,5 kg — algumas levam mais.
 * Ex.: 15 kg em 12 balas => 6 balas de 1,5 kg + 6 balas de 1,0 kg (spec §3).
 */
function distribuirPeso_(kg, baleiros, marshmallows) {
  var nBalas = baleiros - marshmallows;
  var pesoMarsh = marshmallows * PESO_MARSHMALLOW;
  var restante = arredondar_(kg - pesoMarsh);

  if (nBalas <= 0) {
    return { erro: 'Todas as opções são marshmallow: não há bala para absorver o peso.' };
  }
  if (restante < nBalas * PASSO_BALEIRO) {
    return { erro: 'Kg insuficiente para ' + nBalas + ' opções de bala (mínimo ' +
                   (nBalas * PASSO_BALEIRO + pesoMarsh) + ' kg).' };
  }

  var base = Math.floor(restante / nBalas / PASSO_BALEIRO) * PASSO_BALEIRO;
  var sobra = arredondar_(restante - base * nBalas);
  var extras = Math.round(sobra / PASSO_BALEIRO);

  var linhas = [];
  if (marshmallows > 0) {
    linhas.push({ tipo: 'marshmallow', opcoes: marshmallows, kg_cada: PESO_MARSHMALLOW,
                  kg_total: arredondar_(pesoMarsh) });
  }
  if (extras > 0) {
    linhas.push({ tipo: 'bala', opcoes: extras, kg_cada: arredondar_(base + PASSO_BALEIRO),
                  kg_total: arredondar_(extras * (base + PASSO_BALEIRO)) });
  }
  if (nBalas - extras > 0) {
    linhas.push({ tipo: 'bala', opcoes: nBalas - extras, kg_cada: arredondar_(base),
                  kg_total: arredondar_((nBalas - extras) * base) });
  }

  return {
    baleiros: baleiros,
    balas: nBalas,
    marshmallows: marshmallows,
    kg_total: arredondar_(linhas.reduce(function (s, l) { return s + l.kg_total; }, 0)),
    linhas: linhas
  };
}

// ---------------------------------------------------------------------------
// Comissão, líquido e piso (spec §6 e §7.3)
// ---------------------------------------------------------------------------

/**
 * A spec trata comissão como valor absoluto em R$. Aceita "10%" também, para o
 * caso de a intenção ser percentual — devolve { valor, percentual }.
 */
function resolverComissao_(comissao, totalGeral) {
  if (comissao === null || comissao === undefined || comissao === '') {
    return { valor: 0, percentual: 0 };
  }
  var s = String(comissao).trim();
  if (s.indexOf('%') > -1) {
    var p = paraNumero_(s.replace('%', '')) / 100;
    return { valor: arredondar_(p * totalGeral), percentual: p };
  }
  return { valor: paraNumero_(s) || 0, percentual: 0 };
}

function calcularLiquido_(totalGeral, kg, valorFrete, valorPromotor, comissao, cfg) {
  var c = resolverComissao_(comissao, totalGeral);
  var imposto = arredondar_(cfg.aliquota_imposto * totalGeral);
  var custoBalas = arredondar_(kg * cfg.custo_kg);
  var liquido = arredondar_(totalGeral - imposto - custoBalas - valorFrete - valorPromotor - c.valor);
  return {
    imposto: imposto,
    custo_balas: custoBalas,
    frete: arredondar_(valorFrete),
    promotor: arredondar_(valorPromotor),
    comissao: c.valor,
    comissao_percentual: c.percentual,
    liquido: liquido
  };
}

/** Sábado e domingo usam o piso alto; dias úteis, o piso baixo (spec §7.3). */
function contextoDoPiso_(data) {
  if (!data) return 'padrao';
  var d = interpretarData_(data);
  if (!d) return 'padrao';
  var dia = d.getDay();
  return (dia === 0 || dia === 6) ? 'padrao' : 'semana';
}

/** Aceita Date, "2026-09-15" ou "15/09/2026". */
function interpretarData_(data) {
  if (data instanceof Date) return isNaN(data.getTime()) ? null : data;
  var s = String(data).trim();
  var br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (br) {
    var ano = br[3].length === 2 ? 2000 + parseInt(br[3], 10) : parseInt(br[3], 10);
    return new Date(ano, parseInt(br[2], 10) - 1, parseInt(br[1], 10));
  }
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10));
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Três estados: 'abaixo' (fura o piso), 'atencao' (dentro da faixa do piso) e
 * 'ok'. O agente SINALIZA, nunca recusa — a decisão é do operador (spec §7.3).
 */
function avaliarPiso_(liquidoPorEvento, data, cfg) {
  var ctx = contextoDoPiso_(data);
  var min = ctx === 'semana' ? cfg.piso_semana_min : cfg.piso_padrao_min;
  var max = ctx === 'semana' ? cfg.piso_semana_max : cfg.piso_padrao_max;
  var status = liquidoPorEvento < min ? 'abaixo' : (liquidoPorEvento < max ? 'atencao' : 'ok');
  return {
    contexto: ctx,
    piso_min: min,
    piso_max: max,
    liquido_por_evento: arredondar_(liquidoPorEvento),
    status: status,
    distancia_ate_o_piso: arredondar_(liquidoPorEvento - min)
  };
}

// ---------------------------------------------------------------------------
// Cálculo reverso (spec §7)
// ---------------------------------------------------------------------------

/**
 * Até onde vale a pena baixar o preço.
 *   comissão absoluta: T = (líquido + custo + frete + promotor + comissão) / (1 - alíquota)
 *   comissão em %:     T = (líquido + custo + frete + promotor) / (1 - alíquota - %)
 */
function precoMinimo_(liquidoAlvo, kg, valorFrete, valorPromotor, comissao, cfg) {
  var custo = kg * cfg.custo_kg;
  var c = resolverComissao_(comissao, 0);
  var pct = c.percentual;
  var numerador = liquidoAlvo + custo + valorFrete + valorPromotor + (pct ? 0 : c.valor);
  var denominador = 1 - cfg.aliquota_imposto - pct;
  if (denominador <= 0) return { erro: 'Alíquota + comissão >= 100%.' };
  return {
    preco_minimo: arredondar_(numerador / denominador),
    liquido_alvo: liquidoAlvo,
    custo_balas: arredondar_(custo),
    frete: arredondar_(valorFrete),
    promotor: arredondar_(valorPromotor),
    comissao: c.valor
  };
}

/** Quantos kg cabem num budget fechado, preservando o líquido alvo. */
function kgMaximo_(budget, liquidoAlvo, valorFrete, valorPromotor, comissao, cfg) {
  var c = resolverComissao_(comissao, budget);
  var disponivel = budget * (1 - cfg.aliquota_imposto) - valorFrete - valorPromotor - c.valor - liquidoAlvo;
  return {
    kg_maximo: arredondar_(Math.max(0, disponivel / cfg.custo_kg)),
    budget: arredondar_(budget),
    liquido_alvo: liquidoAlvo,
    disponivel_para_balas: arredondar_(Math.max(0, disponivel))
  };
}

// ---------------------------------------------------------------------------
// Orçamento de um evento
// ---------------------------------------------------------------------------

/**
 * Entrada: { cliente, data, local, hora_inicio, hora_fim, convidados, kg,
 *            baleiros, marshmallows, comissao, frete_informado }
 * `local` é obrigatório. `convidados` OU `kg` — pelo menos um.
 * Se vierem os dois e divergirem, `kg` vence e o motor sinaliza.
 */
function orcarEvento_(evento, cfg) {
  var avisos = [];
  var faltando = [];

  var kgInformado = paraNumero_(evento.kg);
  var convidados = paraNumero_(evento.convidados);

  if (!evento.local) faltando.push('local');
  if (kgInformado === null && convidados === null) faltando.push('convidados ou kg');
  if (faltando.length) return { ok: false, faltando: faltando };

  // --- kg ---
  var kg, opcoesKg = null;
  if (kgInformado !== null) {
    kg = kgInformado;
    if (convidados !== null) {
      var sugerido = kgPorConvidados_(convidados, cfg.escada, cfg);
      if (sugerido.opcoes.indexOf(kg) === -1) {
        avisos.push('Kg informado (' + kg + ') fora das opções da faixa de ' +
                    convidados + ' convidados (' + sugerido.opcoes.join(' / ') +
                    '). Usei o kg informado.');
      }
      if (sugerido.aviso) avisos.push(sugerido.aviso);
    }
  } else {
    var esc = kgPorConvidados_(convidados, cfg.escada, cfg);
    kg = esc.kg;
    opcoesKg = esc.opcoes;
    if (esc.aviso) avisos.push(esc.aviso);
  }

  // --- frete ---
  var fr = frete_(evento.local, cfg.frete);
  var freteInformado = paraNumero_(evento.frete_informado);
  if (fr.consultar && freteInformado !== null) {
    fr = { regiao: fr.regiao || evento.local, valor: freteInformado, consultar: false, informado: true };
  }
  if (fr.consultar) {
    return {
      ok: false,
      faltando: ['frete'],
      pergunta: 'Não tenho faixa de frete para "' + evento.local +
                '". Me informa o valor do frete e eu fecho o orçamento.',
      avisos: avisos
    };
  }

  // --- promotor ---
  var horas = duracaoHoras_(evento.hora_inicio, evento.hora_fim, cfg);
  var madrugada = ehMadrugada_(evento.hora_inicio, evento.hora_fim);
  var valorPromotor = promotor_(horas, madrugada, cfg);

  // --- preço ---
  var taxa = precoKg_(kg, cfg.precoKg);
  var totalBalas = arredondar_(kg * taxa);
  var totalGeral = arredondar_(totalBalas + fr.valor + valorPromotor);
  if (kg > 20) {
    avisos.push('Acima de 20 kg o preço por kg é padrão (R$ ' + taxa.toFixed(2) +
                '/kg) e é ponto de negociação.');
  }

  // --- composição ---
  var padrao = composicaoPadrao_(kg, cfg.composicao);
  var baleiros = paraNumero_(evento.baleiros) || padrao.baleiros;
  var marshmallows = evento.marshmallows === undefined || evento.marshmallows === null
    ? padrao.marshmallows
    : paraNumero_(evento.marshmallows);
  var composicao = distribuirPeso_(kg, baleiros, marshmallows);
  if (composicao.erro) avisos.push(composicao.erro);

  return {
    ok: true,
    cliente: evento.cliente || null,
    data: evento.data || null,
    local: evento.local,
    regiao_frete: fr.regiao,
    frete_informado_manualmente: !!fr.informado,
    convidados: convidados,
    kg: kg,
    opcoes_kg: opcoesKg,
    horas: horas,
    madrugada: madrugada,
    preco_kg: arredondar_(taxa),
    total_balas: totalBalas,
    frete: arredondar_(fr.valor),
    promotor: arredondar_(valorPromotor),
    total_geral: totalGeral,
    parcelas: cfg.parcelas,
    valor_parcela: arredondar_(totalGeral / cfg.parcelas),
    composicao: composicao,
    avisos: avisos
  };
}

/** Orçamento de evento único, já com líquido e piso. */
function orcar(evento, config) {
  var cfg = config || carregarConfig_();
  var base = orcarEvento_(evento, cfg);
  if (!base.ok) return base;

  var fin = calcularLiquido_(base.total_geral, base.kg, base.frete, base.promotor,
                             evento.comissao !== undefined ? evento.comissao : cfg.comissao_default, cfg);
  var piso = avaliarPiso_(fin.liquido, evento.data, cfg);

  return {
    ok: true,
    tipo: 'evento',
    publico: montarBlocoPublico_(base),
    interno: {
      total_geral: base.total_geral,
      total_balas: base.total_balas,
      preco_kg: base.preco_kg,
      valor_por_convidado: base.convidados ? arredondar_(base.total_geral / base.convidados) : null,
      g_por_convidado: base.convidados ? arredondar_(base.kg * 1000 / base.convidados) : null,
      imposto: fin.imposto,
      custo_balas: fin.custo_balas,
      frete: fin.frete,
      promotor: fin.promotor,
      comissao: fin.comissao,
      liquido: fin.liquido,
      piso: piso,
      avisos: base.avisos
    },
    detalhe: base
  };
}

/**
 * A apresentação que vai ao cliente mostra TRÊS opções de kg lado a lado, não
 * uma. Esta função devolve as opções já precificadas, na ordem da escada.
 *
 * Com `kg` informado, devolve uma opção só — foi um pedido específico, não uma
 * escolha a oferecer.
 */
function orcarOpcoes(pedido, config) {
  var cfg = config || carregarConfig_();
  var convidados = paraNumero_(pedido.convidados);
  var kgInformado = paraNumero_(pedido.kg);

  var listaKg;
  if (kgInformado !== null) {
    listaKg = [kgInformado];
  } else if (convidados !== null) {
    listaKg = kgPorConvidados_(convidados, cfg.escada, cfg).opcoes;
  } else {
    return { ok: false, faltando: ['convidados ou kg'] };
  }

  var opcoes = [];
  for (var i = 0; i < listaKg.length; i++) {
    var evento = {};
    for (var k in pedido) evento[k] = pedido[k];
    evento.kg = listaKg[i];
    var r = orcar(evento, cfg);
    if (!r.ok) return r;                    // falta local ou frete: pergunta antes de seguir
    opcoes.push(r);
  }

  return {
    ok: true,
    tipo: 'opcoes',
    cliente: pedido.cliente || null,
    data: pedido.data || null,
    local: pedido.local,
    convidados: convidados,
    regiao_frete: opcoes[0].detalhe.regiao_frete,
    publico: opcoes.map(function (o) { return o.publico; }),
    interno: opcoes.map(function (o) { return o.interno; }),
    detalhe: opcoes.map(function (o) { return o.detalhe; }),
    // Tabela de frete mostrada na apresentação: a diferença de cada região em
    // relação à do orçamento, para o cliente ver o acréscimo caso mude o local.
    tabela_frete: montarTabelaFrete_(opcoes[0].detalhe.frete, cfg)
  };
}

/** Regiões e o acréscimo de cada uma sobre o frete já embutido no total. */
function montarTabelaFrete_(freteBase, cfg) {
  return (cfg.frete || FRETE_PADRAO).map(function (linha) {
    if (linha.arbitra === false || linha.valor === null) {
      return { regiao: linha.regiao, texto: 'Consultar' };
    }
    var dif = arredondar_(linha.valor - freteBase);
    return {
      regiao: linha.regiao,
      diferenca: dif,
      texto: dif === 0 ? 'Incluso' : (dif > 0 ? '+ R$ ' : '− R$ ') + formatarReais_(dif)
    };
  }).concat([{ regiao: 'Demais cidades', texto: 'Consultar' }]);
}

/**
 * Ação com N eventos (spec §8): frete e promotor por evento, imposto sobre o
 * total da ação, piso avaliado como líquido_total ÷ nº de eventos.
 */
function orcarAcao(eventos, opcoes, config) {
  var cfg = config || carregarConfig_();
  var opts = opcoes || {};
  var itens = [];
  var somaTotal = 0, somaKg = 0, somaFrete = 0, somaPromotor = 0;
  var avisos = [];

  for (var i = 0; i < eventos.length; i++) {
    var e = orcarEvento_(eventos[i], cfg);
    if (!e.ok) return { ok: false, evento_indice: i, faltando: e.faltando, pergunta: e.pergunta };
    itens.push(e);
    somaTotal += e.total_geral;
    somaKg += e.kg;
    somaFrete += e.frete;
    somaPromotor += e.promotor;
    avisos = avisos.concat(e.avisos);
  }

  // Um budget fechado para a ação substitui a soma dos preços de tabela.
  var budget = paraNumero_(opts.budget);
  var receita = budget !== null ? budget : arredondar_(somaTotal);

  var fin = calcularLiquido_(receita, somaKg, somaFrete, somaPromotor,
                             opts.comissao !== undefined ? opts.comissao : cfg.comissao_default, cfg);
  var piso = avaliarPiso_(fin.liquido / eventos.length, eventos[0].data, cfg);

  if (budget !== null && Math.abs(budget - somaTotal) > 0.005) {
    avisos.push('Budget fechado de R$ ' + budget.toFixed(2) + ' substitui o preço de tabela (R$ ' +
                arredondar_(somaTotal).toFixed(2) + ').');
  }

  return {
    ok: true,
    tipo: 'acao',
    eventos: itens.map(montarBlocoPublico_),
    interno: {
      receita: arredondar_(receita),
      total_tabela: arredondar_(somaTotal),
      kg_total: arredondar_(somaKg),
      imposto: fin.imposto,
      custo_balas: fin.custo_balas,
      frete: fin.frete,
      promotor: fin.promotor,
      comissao: fin.comissao,
      liquido: fin.liquido,
      liquido_por_evento: arredondar_(fin.liquido / eventos.length),
      piso: piso,
      avisos: avisos
    },
    detalhe: itens
  };
}

/** Só o que pode aparecer para o cliente. Custo, imposto e líquido nunca entram. */
function montarBlocoPublico_(base) {
  return {
    cliente: base.cliente,
    data: base.data,
    kg: base.kg,
    baleiros: base.composicao.baleiros,
    balas: base.composicao.balas,
    marshmallows: base.composicao.marshmallows,
    composicao_linhas: base.composicao.linhas || [],
    total_geral: base.total_geral,
    parcelas: base.parcelas,
    valor_parcela: base.valor_parcela,
    duracao_horas: base.horas,
    inclusos: ['Promotor(a) Fini para servir os convidados', 'Saquinho zip Fini para embalagens'],
    condicoes: 'Pix ou cartão de crédito · ' + base.parcelas + 'x sem juros'
  };
}

// ---------------------------------------------------------------------------
// Mensagens de WhatsApp
//
// A formatação mora aqui, e não no cenário Make, porque é texto derivado de
// número: pertence ao motor e entra nos testes. O `texto_cliente` é coberto pelo
// mesmo invariante de vazamento que protege o bloco `publico` — se um dia alguém
// escorregar e imprimir o líquido ali, o teste quebra antes do commit.
// ---------------------------------------------------------------------------

/** Devolve { texto_cliente, texto_interno } a partir de orcarOpcoes. */
function formatarWhatsApp(resultado, config) {
  var cfg = config || carregarConfig_();
  var ops = resultado.publico;
  var internos = resultado.interno;
  var sugerida = ops.length === 3 ? 1 : -1;

  // ------------------------- o que a cliente lê -------------------------
  var cli = ['*FINI CARRINHOS · ORÇAMENTO*'];

  var identificacao = [];
  if (resultado.cliente) identificacao.push(resultado.cliente);
  if (ops[0].data) identificacao.push(ops[0].data);
  if (resultado.local) identificacao.push(resultado.local);
  if (identificacao.length) cli.push(identificacao.join(' · '));

  ops.forEach(function (o, i) {
    var opcoes = [];
    if (o.balas) opcoes.push(o.balas + (o.balas > 1 ? ' opções de balas' : ' opção de bala'));
    if (o.marshmallows) {
      opcoes.push(o.marshmallows + (o.marshmallows > 1 ? ' opções de marshmallow' : ' opção de marshmallow'));
    }
    cli.push('');
    cli.push('*' + String(o.kg).replace('.', ',') + ' kg*' + (i === sugerida ? '  _(sugerida)_' : ''));
    cli.push(o.parcelas + 'x de R$ ' + formatarReais_(o.valor_parcela) +
             '  ·  total R$ ' + formatarReais_(o.total_geral));
    if (opcoes.length) cli.push('_' + opcoes.join(' · ') + '_');
  });

  cli.push('');
  cli.push('*O que está incluso*');
  cli.push('• Duração de ' + String(ops[0].duracao_horas).replace('.', ',') + ' horas');
  ops[0].inclusos.forEach(function (t) { cli.push('• ' + t); });

  cli.push('');
  cli.push('*Frete*');
  cli.push(resultado.regiao_frete ? 'Incluso para ' + resultado.regiao_frete : 'Incluso');

  cli.push('');
  cli.push('*Pagamento*');
  cli.push(ops[0].condicoes);

  // ------------------------- o que só o Will lê -------------------------
  var tabela = [
    [''].concat(ops.map(function (o) { return String(o.kg).replace('.', ',') + ' kg'; })),
    ['Total'].concat(internos.map(function (i) { return formatarReais_(i.total_geral); })),
    ['Líquido'].concat(internos.map(function (i) { return formatarReais_(i.liquido); })),
    ['Mínimo'].concat(internos.map(function (i, idx) {
      var m = precoMinimo_(i.piso.piso_min, ops[idx].kg, i.frete, i.promotor, i.comissao, cfg);
      return formatarReais_(m.preco_minimo);
    }))
  ];
  var larguras = tabela[0].map(function (_, c) {
    return Math.max.apply(null, tabela.map(function (linha) { return String(linha[c]).length; }));
  });
  var grade = tabela.map(function (linha) {
    return linha.map(function (v, c) {
      return c === 0 ? String(v).padEnd(larguras[c]) : String(v).padStart(larguras[c]);
    }).join('  ');
  }).join('\n');

  var rotulos = { ok: 'ok', atencao: 'atenção', abaixo: 'ABAIXO DO PISO' };
  var piso = internos[0].piso;

  var op = ['🔒 *Só você vê*', '```', grade, '```'];

  op.push('Piso R$ ' + formatarReais_(piso.piso_min) + ' a R$ ' + formatarReais_(piso.piso_max) +
          ' (' + (piso.contexto === 'semana' ? 'dia de semana' : 'fim de semana') + ')  ·  ' +
          internos.map(function (i) { return rotulos[i.piso.status]; }).join(' · '));
  op.push('Frete R$ ' + formatarReais_(internos[0].frete) +
          '  ·  Promotor R$ ' + formatarReais_(internos[0].promotor) +
          '  ·  Imposto ' + formatarReais_(cfg.aliquota_imposto * 100) + '%');

  // Referência na opção que o motor sugere, não na primeira da lista.
  var ref = sugerida >= 0 ? sugerida : 0;
  if (internos[ref].valor_por_convidado) {
    op.push('Por convidado R$ ' + formatarReais_(internos[ref].valor_por_convidado) +
            '  ·  ' + Math.round(internos[ref].g_por_convidado) + ' g/pessoa' +
            (ops.length > 1 ? ' (na opção de ' + String(ops[ref].kg).replace('.', ',') + ' kg)' : ''));
  }

  var avisos = [];
  internos.forEach(function (i) {
    (i.avisos || []).forEach(function (a) { if (avisos.indexOf(a) === -1) avisos.push(a); });
  });
  if (avisos.length) {
    op.push('');
    op.push('⚠️ ' + avisos.join('\n⚠️ '));
  }

  return { texto_cliente: cli.join('\n'), texto_interno: op.join('\n') };
}

// ---------------------------------------------------------------------------
// Configuração vinda da planilha (só roda no Apps Script)
// ---------------------------------------------------------------------------

var ABAS = {
  PARAMETROS: 'Parametros',
  PRECO_KG: 'PrecoKg',
  FRETE: 'Frete',
  ESCADA: 'EscadaConvidados',
  COMPOSICAO: 'ComposicaoPadrao',
  ORCAMENTOS: 'Orcamentos'
};

/** Config padrão + o que a planilha sobrescrever. Sem planilha, roda nos padrões. */
function carregarConfig_() {
  var cfg = {};
  for (var k in PADRAO) cfg[k] = PADRAO[k];
  cfg.precoKg = PRECO_KG_PADRAO;
  cfg.frete = FRETE_PADRAO;
  cfg.escada = ESCADA_PADRAO;
  cfg.composicao = COMPOSICAO_PADRAO;

  if (typeof SpreadsheetApp === 'undefined') return cfg;

  var ss;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { return cfg; }
  if (!ss) return cfg;

  var params = lerAba_(ss, ABAS.PARAMETROS);
  for (var i = 0; i < params.length; i++) {
    var chave = String(params[i][0] || '').trim();
    if (!chave) continue;
    var valor = paraNumero_(params[i][1]);
    cfg[chave] = valor === null ? params[i][1] : valor;
  }

  var preco = lerAba_(ss, ABAS.PRECO_KG);
  if (preco.length) {
    cfg.precoKg = preco
      .filter(function (l) { return paraNumero_(l[0]) !== null; })
      .map(function (l) { return { kg: paraNumero_(l[0]), preco: paraNumero_(l[1]) }; });
  }

  var frete = lerAba_(ss, ABAS.FRETE);
  if (frete.length) {
    cfg.frete = frete
      .filter(function (l) { return String(l[0] || '').trim(); })
      .map(function (l) {
        return {
          regiao: String(l[0]).trim(),
          valor: paraNumero_(l[1]),
          arbitra: String(l[2]).toLowerCase() !== 'false' && l[2] !== false,
          aliases: String(l[3] || l[0]).split(/[;,]/).map(function (s) { return normalizar_(s); })
                     .filter(function (s) { return s; })
        };
      });
  }

  var escada = lerAba_(ss, ABAS.ESCADA);
  if (escada.length) {
    cfg.escada = escada
      .filter(function (l) { return paraNumero_(l[0]) !== null; })
      .map(function (l) {
        return {
          convidados: paraNumero_(l[0]),
          opcoes: [paraNumero_(l[1]), paraNumero_(l[2]), paraNumero_(l[3])]
                    .filter(function (v) { return v !== null; })
        };
      });
  }

  var comp = lerAba_(ss, ABAS.COMPOSICAO);
  if (comp.length) {
    cfg.composicao = comp
      .filter(function (l) { return paraNumero_(l[0]) !== null; })
      .map(function (l) {
        return {
          kg: paraNumero_(l[0]),
          balas: paraNumero_(l[1]),
          marshmallows: paraNumero_(l[2]),
          baleiros: paraNumero_(l[3])
        };
      });
  }

  return cfg;
}

/** Linhas da aba sem o cabeçalho. Aba ausente devolve lista vazia. */
function lerAba_(ss, nome) {
  var aba = ss.getSheetByName(nome);
  if (!aba || aba.getLastRow() < 2) return [];
  return aba.getRange(2, 1, aba.getLastRow() - 1, aba.getLastColumn()).getValues();
}

// ---------------------------------------------------------------------------
// Log (spec: campos compatíveis com uma integração futura ao ClickUp)
// ---------------------------------------------------------------------------

function registrarOrcamento_(resultado, origem) {
  if (typeof SpreadsheetApp === 'undefined') return null;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return null;
  var aba = ss.getSheetByName(ABAS.ORCAMENTOS);
  if (!aba) {
    aba = ss.insertSheet(ABAS.ORCAMENTOS);
    aba.appendRow(['id', 'timestamp', 'origem', 'cliente', 'data_evento', 'local',
                   'horas', 'convidados', 'kg', 'baleiros', 'total_geral', 'liquido',
                   'piso_status', 'url_imagem', 'status', 'clickup_task_id']);
  }
  var id = 'ORC-' + new Date().getTime().toString(36).toUpperCase();
  var d = resultado.detalhe || {};
  var p = resultado.publico || {};
  aba.appendRow([
    id, new Date(), origem || 'whatsapp', p.cliente || '', p.data || '', d.local || '',
    d.horas || '', d.convidados || '', p.kg || '', p.baleiros || '',
    resultado.interno.total_geral || resultado.interno.receita || '',
    resultado.interno.liquido || '',
    resultado.interno.piso ? resultado.interno.piso.status : '',
    resultado.url_imagem || '', 'gerado', ''
  ]);
  return id;
}

// ---------------------------------------------------------------------------
// Endpoint HTTP
// ---------------------------------------------------------------------------

/**
 * O Web App é publicado com acesso "qualquer pessoa" (o Make precisa chamar sem
 * OAuth), então a URL sozinha não protege nada. Se a Script Property SEGREDO
 * estiver definida, todo pedido precisa trazer o mesmo valor em `segredo`.
 *
 * Sem a propriedade definida o endpoint fica aberto — de propósito, para o motor
 * funcionar antes de qualquer configuração. O `ping` avisa quando é esse o caso.
 * O que está exposto é cálculo de preço de tabela, não dado de cliente.
 */
function segredoConfigurado_() {
  if (typeof PropertiesService === 'undefined') return null;
  try {
    return PropertiesService.getScriptProperties().getProperty('SEGREDO') || null;
  } catch (err) {
    return null;
  }
}

function doPost(e) {
  var resposta;
  try {
    var body = JSON.parse(e.postData.contents);
    var cfg = carregarConfig_();

    var esperado = segredoConfigurado_();
    if (esperado && body.segredo !== esperado) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, erro: 'Segredo inválido.' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    switch (body.action) {
      case 'ping':
        resposta = {
          ok: true,
          versao: '1.1',
          passo: 'motor + whatsapp',
          segredo: esperado ? 'configurado' : 'NÃO CONFIGURADO — endpoint aberto'
        };
        break;
      case 'orcarWhatsApp':
        resposta = orcarOpcoes(body.pedido || body, cfg);
        if (resposta.ok) {
          var textos = formatarWhatsApp(resposta, cfg);
          resposta.texto_cliente = textos.texto_cliente;
          resposta.texto_interno = textos.texto_interno;
          resposta.id = registrarOrcamento_(
            { publico: resposta.publico[0], interno: resposta.interno[0], detalhe: resposta.detalhe[0] },
            body.origem || 'whatsapp'
          );
        }
        break;
      case 'orcar':
        resposta = orcar(body.evento || body, cfg);
        if (resposta.ok) resposta.id = registrarOrcamento_(resposta, body.origem);
        break;
      case 'orcarOpcoes':
        resposta = orcarOpcoes(body.pedido || body, cfg);
        break;
      case 'orcarAcao':
        resposta = orcarAcao(body.eventos, body.opcoes, cfg);
        if (resposta.ok) resposta.id = registrarOrcamento_(resposta, body.origem);
        break;
      case 'precoMinimo':
        resposta = precoMinimo_(paraNumero_(body.liquido_alvo), paraNumero_(body.kg),
                                paraNumero_(body.frete), paraNumero_(body.promotor),
                                body.comissao, cfg);
        resposta.ok = true;
        break;
      case 'kgMaximo':
        resposta = kgMaximo_(paraNumero_(body.budget), paraNumero_(body.liquido_alvo),
                             paraNumero_(body.frete), paraNumero_(body.promotor),
                             body.comissao, cfg);
        resposta.ok = true;
        break;
      default:
        resposta = { ok: false, erro: 'Ação desconhecida: ' + body.action };
    }
  } catch (err) {
    resposta = { ok: false, erro: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(resposta))
    .setMimeType(ContentService.MimeType.JSON);
}
