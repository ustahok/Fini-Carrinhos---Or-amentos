# Fini Carrinhos · Agente de Orçamento por WhatsApp

## O que é

O Will manda uma mensagem em texto livre no WhatsApp ("orçamento pra Ana, 15/09,
Santo André, 100 convidados") e recebe de volta **uma imagem de orçamento pronta
para encaminhar ao cliente**, mais um **bloco interno** com o líquido projetado e
a distância até o piso de margem.

Antes disso, o orçamento era montado à mão: escolher uma apresentação
pré-formatada por faixa de convidados, ou tirar print de uma tabela do Sheets.
Lento, não padronizado, e sem enxergar a margem na hora de negociar.

## Princípio inegociável

O modelo **só interpreta texto livre e extrai parâmetros**. Todo cálculo é
determinístico, a partir da planilha. **Nenhum valor é gerado pelo modelo.**
Parâmetro obrigatório ausente → o agente pergunta, não assume.

Se você for mexer neste projeto: não coloque aritmética de preço em prompt.
Preço vive em `codigo.gs` e na planilha, e é coberto por `testes/casos.json`.

## Projeto separado

Este projeto é **isolado** do "Fini Carrinho · Estoque" (repo
`Fini-Carrinho---Estoque-Fable5`). Nenhum código é compartilhado. Não escreva
naquele repositório a partir daqui. Se precisar de logo ou fontes para o
template, **copie** os arquivos para cá.

Integração com ClickUp / Typeform / Olist está **fora de escopo na v1**, mas a
aba de log grava `id` e uma coluna `clickup_task_id` vazia, para que a
integração futura não exija retrabalho.

## Regras de negócio

A fonte normativa é `spec.md` (v1.1, escrita pelo Will). Resumo do que importa:

- **Preço:** `Total = kg × preço_kg + frete + promotor`. `preço_kg` vem de
  âncoras (12→135 · 15→128 · 16→127,5 · 18→125 · 20→125) com **interpolação
  linear sobre a taxa, nunca sobre o total**.
- **Frete:** São Paulo 150 · ABC 200 · Osasco/Guarulhos 250 · demais: o agente
  **não arbitra**, pergunta ao operador.
- **Promotor:** `150 + 50 × max(0, horas − 4) + (100 se madrugada)`.
- **Líquido:** `Total − 8,5% imposto − kg × 31,68 − frete − promotor − comissão`.
  Frete e promotor são **repasse puro**: toda a margem vem do spread do kg.
- **Piso de líquido:** 500–600 em dia de semana, 700–1.000 nos demais. O agente
  **sinaliza, nunca recusa** — a decisão é do operador. Em ação multi-evento o
  piso é por evento (`líquido_total ÷ nº_eventos`).
- **Baleiros:** 9, 12 ou 18 opções. Marshmallow é sempre 0,5 kg; o restante do
  peso é distribuído entre as balas em passos de 0,5 kg.
  ⚠️ **Não existe** a regra `kg = baleiros − 0,5 × marshmallows`. Ela parece
  existir porque o material de marketing só publica o caso arrumadinho. Não
  implemente como validação (spec §3).
- **Escada convidados → kg:** tabela **curada**, não fórmula. g/convidado é
  rótulo derivado, não regra de conversão.

## Arquitetura

| Peça | Papel |
|---|---|
| Planilha Google Sheets | Toda regra comercial, editável pelo Will sem tocar em código |
| `codigo.gs` (Apps Script Web App) | Motor determinístico, geração de imagem/PDF, log |
| Cenário Make | WhatsApp entra e sai (BotConversa) + extração de parâmetros via Claude |

A extração usa o proxy da API Anthropic que já existe no Make do Will
(webhook → chave no Data Store 128074 → `POST api.anthropic.com/v1/messages`).

O núcleo de cálculo de `codigo.gs` **não usa nenhuma API do Google de propósito**,
para rodar igual no Apps Script e no Node. É isso que permite
`node testes/runner.js` validar as contas sem subir nada.

## Testes

```bash
node testes/runner.js
```

37 casos, todos ancorados em valores reais: os 10 pontos publicados nas
apresentações, o caso de líquido da spec §6 (709,26) e o Grupo TOP da §8
(2.579,58 / 2.798,16). **Rode antes de qualquer commit que toque em `codigo.gs`.**
Se um caso quebrar, ou o motor está errado, ou a regra mudou e `spec.md` precisa
ser atualizada junto.

Dois invariantes que valem a pena entender antes de mexer:

- **Monotonia**: o total tem de crescer com o kg de 8 a 25 kg. O trecho entre 12
  e 15 kg é o de risco, porque é onde a taxa cai — mexer nas âncoras pode criar
  uma faixa onde pedir mais kg sai mais barato.
- **Vazamento**: o bloco `publico` nunca pode conter custo, imposto, líquido,
  piso, margem ou comissão. É o que vai para o cliente.

## Design system Fini

Rosa `#E83278` · roxo `#554596` · amarelo `#FFEE00` · fundo `#f0eef8`.
Fontes Nunito e FiniFun. As apresentações usam amarelo com pílulas vermelhas.

## Estado

- **Passo 1 — motor + testes: pronto.**
- Passo 2 — template Slides e geração da imagem: pendente.
- Passo 3 — extrator Claude, cenário Make e BotConversa: pendente.
