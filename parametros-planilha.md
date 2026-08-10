# Planilha de parâmetros

Toda regra comercial vive aqui, para você mudar preço sem mexer em código.

Crie uma planilha nova no Google Sheets (ex: **"Fini Orçamento — Parâmetros"**),
com as abas abaixo. Depois: **Extensões → Apps Script**, cole o `codigo.gs`,
salve e implante como **App da Web** (executar como *Eu*, acesso *Qualquer pessoa*).

> **A planilha é opcional para começar.** O `codigo.gs` já traz todos estes
> valores embutidos como padrão. As abas só **sobrescrevem** o que existir nelas
> — uma aba ausente ou vazia mantém o padrão do código. Isso significa que você
> pode subir o motor hoje e montar a planilha depois.

**A primeira linha de cada aba é cabeçalho e é ignorada.**

---

## Aba `Parametros`

Duas colunas: chave e valor.

| chave | valor | o que é |
|---|---|---|
| `custo_kg` | 31,68 | custo por kg, igual para bala e marshmallow |
| `aliquota_imposto` | 0,085 | 8,5% — tabela do Simples Nacional |
| `promotor_base` | 150 | valor do promotor até a duração padrão |
| `promotor_hora_extra` | 50 | por hora além da duração padrão |
| `promotor_madrugada` | 100 | adicional se o evento passar da meia-noite |
| `duracao_padrao_h` | 4 | horas inclusas |
| `parcelas` | 3 | 3x sem juros |
| `piso_semana_min` | 500 | piso de líquido em dia de semana |
| `piso_semana_max` | 600 | acima disso o líquido é confortável |
| `piso_padrao_min` | 700 | piso de líquido em fim de semana |
| `piso_padrao_max` | 1000 | acima disso o líquido é confortável |
| `g_por_convidado_default` | 80 | usado só acima da última faixa da escada |
| `comissao_default` | 0 | valor em R$ (aceita `10%` se quiser percentual) |

Entre `min` e `max` o agente marca **atenção**; abaixo do `min`, marca **abaixo
do piso**. Ele nunca recusa um orçamento — só sinaliza.

---

## Aba `PrecoKg`

As âncoras da tabela de preço. Entre duas âncoras o motor **interpola a taxa**
(nunca o total).

| kg | preco_kg |
|---|---|
| 12 | 135,00 |
| 15 | 128,00 |
| 16 | 127,50 |
| 18 | 125,00 |
| 20 | 125,00 |

Abaixo de 12 kg vale 135,00. Acima de 20 kg vale 125,00, e o agente avisa que é
ponto de negociação.

⚠️ Se você mexer nestes números, **rode `node testes/runner.js` depois**. Baixar
demais uma âncora do meio pode criar uma faixa onde pedir mais kg sai mais
barato — o teste de monotonia pega isso.

---

## Aba `Frete`

| regiao | valor | arbitra | aliases |
|---|---|---|---|
| ABC | 200 | VERDADEIRO | abc; santo andre; sao bernardo; sao caetano; diadema; maua |
| Osasco | 250 | VERDADEIRO | osasco |
| Guarulhos | 250 | VERDADEIRO | guarulhos |
| São Paulo | 150 | VERDADEIRO | sao paulo; capital; sp |

- **`aliases`** é a lista de termos que o motor procura dentro do local, separados
  por `;`. Acento e maiúscula não importam.
- **A ordem das linhas importa.** O primeiro alias que casar vence. Por isso o
  ABC vem antes de São Paulo: um endereço em Santo André quase sempre traz
  "São Paulo" junto.
- **`arbitra` = FALSO** faz o agente perguntar o valor em vez de decidir sozinho.
- Local que não casa com nenhuma linha cai automaticamente em "pergunta ao
  operador" — é o caso de Alphaville, Sorocaba, interior.

Para transformar um "consultar" em regra fixa, é só acrescentar a linha aqui.

---

## Aba `EscadaConvidados`

As três opções de kg oferecidas por faixa de convidados. É **curada**, não
fórmula: o g/convidado é consequência, não regra.

| convidados | opcao_a | opcao_b | opcao_c |
|---|---|---|---|
| 50 | 8 | 8,5 | 9 |
| 60 | 8 | 8,5 | 9 |
| 70 | 8,5 | 9 | 10,5 |
| 80 | 9 | 10,5 | 11,5 |
| 90 | 9 | 10,5 | 11,5 |
| 100 | 10,5 | 11,5 | 12 |
| 120 | 11,5 | 12 | 16 |
| 150 | 15 | 16 | 18 |
| 200 | 15 | 16 | 20 |

Quando você não informa o kg, o motor usa a **opção do meio** (`opcao_b`).

- Número de convidados **entre faixas** (ex: 110): encaixa na faixa mais próxima
  e avisa.
- Número **acima da última faixa** (ex: 300): calcula por
  `g_por_convidado_default` e avisa que está fora da tabela.

---

## Aba `ComposicaoPadrao`

Quantas opções de bala e de marshmallow cada kg leva por padrão.

| kg | balas | marshmallows | baleiros |
|---|---|---|---|
| 8 | 7 | 2 | 9 |
| 8,5 | 8 | 1 | 9 |
| 9 | 9 | 0 | 9 |
| 10,5 | 9 | 3 | 12 |
| 11,5 | 11 | 1 | 12 |
| 12 | 12 | 0 | 12 |
| 15 | 12 | 0 | 12 |
| 16 | 14 | 4 | 18 |
| 18 | 18 | 0 | 18 |
| 20 | 18 | 0 | 18 |

São **defaults de apresentação, não restrições**. O cliente pode pedir qualquer
combinação de baleiros e marshmallows: o motor redistribui o peso sozinho
(marshmallow sempre 0,5 kg, o resto dividido entre as balas em passos de 0,5 kg).

Exemplo: 15 kg em 12 opções, todas bala → 6 balas de 1,5 kg + 6 balas de 1 kg.

---

## Aba `Orcamentos`

Criada sozinha no primeiro orçamento. Não precisa montar à mão.

`id · timestamp · origem · cliente · data_evento · local · horas · convidados ·
kg · baleiros · total_geral · liquido · piso_status · url_imagem · status ·
clickup_task_id`

A coluna `clickup_task_id` fica vazia na v1 — existe para a integração futura
com o ClickUp não exigir remontar o histórico.
