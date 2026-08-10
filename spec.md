# Especificação — Agente de Orçamento por WhatsApp
## Fini Carrinhos · repo `Fini-Carrinhos---Or-amentos`

Versão 1.1 · 10/08/2026

---

## 1. Objetivo

Receber uma mensagem em texto livre (WhatsApp, via BotConversa), extrair os parâmetros do evento e devolver:

- **(a)** um orçamento em PDF com layout Fini, pronto para encaminhar ao cliente;
- **(b)** a projeção de **líquido** daquele orçamento, visível só para o operador.

O agente é isolado hoje. Integração com ClickUp/Olist fica para depois.

### Princípio de arquitetura (inegociável)

O modelo **só interpreta texto livre e extrai parâmetros**. Todo cálculo é determinístico e vem da planilha de parâmetros. **Nenhum valor é gerado pelo modelo.** Se um parâmetro obrigatório não for extraído, o agente pergunta — não assume.

---

## 2. Entradas

| Campo | Obrigatório | Observação |
|---|---|---|
| `cliente` | não | nome para o PDF |
| `data` | não | usada para classificar dia útil / fim de semana |
| `local` | **sim** | define faixa de frete |
| `hora_inicio` / `hora_fim` | não | default 4h; define hora extra e madrugada |
| `convidados` | condicional | obrigatório se `kg` ausente |
| `kg` | condicional | obrigatório se `convidados` ausente |
| `baleiros` | não | 9, 12 ou 18; default pela faixa de kg |
| `budget` | não | ativa o modo reverso (§7) |
| `eventos[]` | não | lista, para ações multi-dia (§8) |

**Precedência:** se `kg` vier informado, usa `kg`. Se vier só `convidados`, converte pela escada (§4). Se vierem os dois e forem inconsistentes, usa `kg` e sinaliza.

---

## 3. Composição de baleiros

**Regra real: `kg` e `baleiros` são independentes.**

- O cliente escolhe **quantas opções** quer no carrinho: 9, 12 ou 18 baleiros.
- Cada opção pode ser bala ou marshmallow.
- **Marshmallow entra sempre com 500 g fixos** (produto maior e mais leve).
- O kg contratado é distribuído livremente entre as opções: a diferença é compensada colocando mais de algumas balas.

**Exemplos reais:**

| Contratado | Composição |
|---|---|
| 15 kg, 12 opções (todas bala) | 6 balas com 1,5 kg + 6 balas com 1 kg |
| 9 kg, 9 opções (8 balas + 1 marsh) | marsh 0,5 kg + uma bala com 1,5 kg + 7 balas com 1 kg |
| 8 kg, 9 opções (7 balas + 2 marsh) | 2 marsh × 0,5 kg + 7 balas × 1 kg |

> **Nota de implementação:** o material de marketing publica só o caso "arrumadinho" (cada bala = 1 kg exato), o que faz parecer que existe a restrição `kg = baleiros − 0,5 × marshmallows`. **Essa restrição não existe.** Não implementar como validação.

O motor precisa apenas: (1) registrar o nº de baleiros escolhido, (2) registrar quantos são marshmallow, (3) calcular a distribuição de peso para a folha de separação.

---

## 4. Escada convidados → kg

Tabela de lookup por faixa de convidados, com três opções de kg cada. É **curada, não fórmula** — o g/convidado é o rótulo derivado (`kg × 1000 ÷ convidados`) e não deve ser usado como regra de conversão.

| Faixa | Opção A | Opção B | Opção C |
|---|---|---|---|
| 50 | 8,0 | 8,5 | 9,0 |
| 60 | 8,0 | 8,5 | 9,0 |
| 70 | 8,5 | 9,0 | 10,5 |
| 80 | 9,0 | 10,5 | 11,5 |
| 90 | 9,0 | 10,5 | 11,5 |
| 100 | 10,5 | 11,5 | 12,0 |
| 120 | 11,5 | 12,0 | 16,0 |
| 150 | 15,0 | 16,0 | 18,0 |
| 200 | 15,0 | 16,0 | 20,0 |

Faixas fora da tabela: interpolar para a faixa mais próxima e sinalizar ao operador.

### 4.1 Composições publicadas (default de baleiros por kg)

| kg | Balas | Marshmallows | Baleiros |
|---|---|---|---|
| 8,0 | 7 | 2 | 9 |
| 8,5 | 8 | 1 | 9 |
| 9,0 | 9 | 0 | 9 |
| 10,5 | 9 | 3 | 12 |
| 11,5 | 11 | 1 | 12 |
| 12,0 | 12 | 0 | 12 |
| 15,0 | 12 | 0 | 12 |
| 16,0 | 14 | 4 | 18 |
| 18,0 | 18 | 0 | 18 |
| 20,0 | — | — | 12 ou 18 |

São **defaults de apresentação**, não restrições. O cliente pode escolher qualquer combinação; o peso é redistribuído conforme §3.

> Observação: 50 e 60 têm opções idênticas, assim como 80 e 90. Confirmar se é proposital ou erro no material.

## 5. Preço de venda

```
Total Geral = (kg × preço_kg) + frete + promotor
```

### 5.1 Tabela de preço_kg

Âncoras validadas contra os 10 pontos publicados:

| kg | preço_kg |
|---|---|
| até 12,0 | 135,00 |
| 15,0 | 128,00 |
| 16,0 | 127,50 |
| 18,0 | 125,00 |
| 20,0 ou mais | 125,00 |

Entre âncoras: **interpolação linear sobre a taxa**, nunca sobre o total.

Reproduz exatamente: 8→1.380 · 8,5→1.447,50 · 9→1.515 · 10,5→1.717,50 · 11,5→1.852,50 · 12→1.920 · 15→2.220 · 16→2.340 · 18→2.550 · 20→2.800

Acima de 20 kg: mantém 125,00/kg como padrão. Valor negociável — o agente aplica o padrão e sinaliza que é ponto de negociação.

### 5.2 Frete (por evento)

| Região | Valor |
|---|---|
| São Paulo capital | 150 |
| ABC | 200 |
| Osasco / Guarulhos | 250 |
| Demais | consultar — o agente **não** arbitra |

### 5.3 Promotor (por evento)

```
promotor = 150 + 50 × max(0, horas − 4) + (100 se madrugada)
```

- 4h padrão → 150
- 5h → 200
- 4h de madrugada → 250

Gatilho de madrugada: qualquer parte do evento após 00:00.

> Esta é a regra **de orçamento**. O pagamento real à promotora é ajustado manualmente depois.

---

## 6. Custo e líquido

```
Líquido = Total Geral
        − imposto
        − comissão
        − (kg × custo_kg)
        − frete
        − promotor

imposto = 8,5% × Total Geral
```

**Frete e promotor são repasse puro** — entram no preço e saem como custo, margem zero. Toda a margem vem do spread do kg.

### Parâmetros

| Parâmetro | Valor | Nota |
|---|---|---|
| `custo_kg` | 31,68 | **fixo**, por kg, para bala e marshmallow igualmente |
| `aliquota_imposto` | 8,5% | base da tabela do Simples Nacional |
| `comissao` | 0,00 | parametrizável por venda indicada |

**Margem bruta por kg @135:** R$ 103,32

### Validação obrigatória (caso de teste)

Entrada: 50 convidados, 160 g/convidado, 8 kg, SP, 4h, comissão 0

```
Total balas    1.080,00
Transporte       150,00
Promotor         150,00
Total Geral    1.380,00
Imposto 8,5%    −117,30
Custo balas     −253,44
Frete           −150,00
Promotor        −150,00
Líquido          709,26
```

---

## 7. Cálculo reverso

Duas direções obrigatórias além do orçamento direto.

### 7.1 Preço mínimo (até onde vale a pena baixar)

```
Preço mínimo = (líquido_alvo + kg×custo_kg + frete + promotor + comissão) ÷ 0,915
```

### 7.2 Budget → kg

Dado um budget fechado:

```
kg_máximo = (budget × 0,915 − frete − promotor − comissão − líquido_alvo) ÷ custo_kg
```

### 7.3 Pisos de líquido

| Contexto | Piso |
|---|---|
| Dia de semana / baixo movimento | 500 – 600 |
| Demais dias | 700 – 1.000 |

O agente sinaliza quando o orçamento fura o piso. **Não recusa automaticamente** — a decisão é do operador.

**O piso é por EVENTO**, não por ação. Em ação multi-dia: `líquido_total ÷ nº_eventos ≥ piso`.

---

## 8. Múltiplos eventos

Ação com N ocorrências (dias/locais diferentes):

- `frete` e `promotor` são calculados e somados **por evento**
- `kg` pode ser diferente por evento
- `imposto` incide sobre o total da ação
- o líquido é consolidado para a ação inteira

### Caso de teste — Grupo TOP

2 eventos · ~300 pessoas · 1h30 cada · ambos SP capital · dia de semana · budget total 2.300

```
Receita                        2.300,00
Imposto 8,5%                    −195,50
Frete + promotor (2 × 300)      −600,00
Disponível para balas + lucro   1.504,50

Líquido = 1.504,50 − 31,68 × kg_total
```

| g/pessoa | kg | Líquido total | Por evento | Piso (500) |
|---|---|---|---|---|
| 53 | 15,9 | 1.000,00 | 500,00 | no limite |
| 60 | 18,0 | 934,26 | 467,13 | abaixo |
| 80 | 24,0 | 744,18 | 372,09 | abaixo |
| 100 | 30,0 | 554,10 | 277,05 | abaixo |

**Resultado esperado do motor: sinalizar que o orçamento fura o piso.** A 80 g/pessoa o preço mínimo seria:

```
(1.000 + 24×31,68 + 600) ÷ 0,915 = R$ 2.579,58   (piso 500/evento)
(1.200 + 24×31,68 + 600) ÷ 0,915 = R$ 2.798,16   (piso 600/evento)
```

Esse caso é a validação principal do cálculo reverso: o motor precisa produzir ~2.580 como piso e apontar 2.300 como abaixo dele.

## 9. Saída

**PDF ao cliente** — layout Fini: quantidade em kg, valor total, valor 3x sem juros, composição de baleiros, inclusos (promotor, saquinho zip), condições (Pix ou cartão, 3x sem juros), duração.

**Bloco interno ao operador** (nunca no PDF): custo das balas, imposto, frete, promotor, líquido projetado, e a distância até o piso.

---

## 10. Pendências

Todas as pendências da v1.0 foram resolvidas e incorporadas. Em aberto:

| # | Item | Bloqueia |
|---|---|---|
| 1 | Faixas 50/60 e 80/90 têm opções idênticas — proposital ou erro no material? | §4 |
| 2 | Em ação multi-evento com preço de pacote, o líquido é rateado igualmente entre eventos (assumido) ou proporcional ao kg de cada um? | §8 |

Nenhuma das duas bloqueia a implementação.

## 11. Fora de escopo (v1)

- Integração ClickUp / Olist
- Envio automático ao cliente (William encaminha manualmente)
- Múltiplos carrinhos no mesmo evento
