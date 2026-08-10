# Fini Carrinhos · Agente de Orçamento por WhatsApp

Você manda uma mensagem no WhatsApp e recebe o orçamento pronto para encaminhar
ao cliente — mais um resumo que só você vê, com o líquido daquele orçamento e o
quanto ainda dá para baixar o preço.

> **Estado: Passo 1 concluído.** O motor de cálculo está pronto e validado.
> A imagem do orçamento (Passo 2) e o WhatsApp (Passo 3) ainda não.

## Como vai funcionar

```
Você no WhatsApp:  "orçamento pra Ana, 15/09, Santo André, 100 convidados"
                              ↓
        o agente lê e separa os dados do pedido
                              ↓
        o motor calcula com a sua tabela de preços
                              ↓
Você recebe:  a imagem do orçamento  +  "líquido R$ 1.022 · piso ok"
                              ↓
        você confere e encaminha para a cliente
```

**Nada é enviado ao cliente automaticamente.** Quem encaminha é você.

## O que o agente faz e o que não faz

**Faz:**

- Calcula o valor a partir dos kg, do local e do horário
- Converte convidados em kg pela sua tabela, quando você não informa o kg
- Monta a composição de baleiros e distribui o peso entre as opções
- Mostra o líquido, o imposto, o custo e a distância até o seu piso de margem
- Diz até onde dá para baixar o preço sem furar o piso
- Trata ação com vários eventos (frete e promotor por evento, piso por evento)

**Não faz:**

- **Não inventa valor nenhum.** A parte de inteligência artificial só entende o
  que você escreveu; toda conta sai da planilha. Se faltar informação, ele
  pergunta em vez de chutar.
- Não decide frete de cidade fora da tabela — pergunta a você.
- Não recusa orçamento por margem baixa. Ele avisa; a decisão é sua.
- Não manda nada para o cliente.

## O que você pode escrever

Nem tudo é obrigatório. O mínimo é **o local** e **convidados ou kg**.

| Informação | Exemplo | Observação |
|---|---|---|
| Cliente | "pra Ana" | aparece no orçamento |
| Data | "15/09" | define se o piso é de dia de semana ou de fim de semana |
| Local | "Santo André" | **obrigatório** — define o frete |
| Horário | "das 16h às 21h" | define hora extra e madrugada; sem isso, assume 4h |
| Convidados | "100 convidados" | vira kg pela sua tabela |
| Kg | "12 kg" | se você informar, **vence** o número de convidados |

Exemplos que funcionam:

- `orçamento pra Ana, 15/09, Santo André, 100 convidados`
- `orçamento 12 kg em Guarulhos`
- `Marcos, 20/12, São Paulo, 150 convidados, das 20h às 1h`

## Como o preço é formado

```
Total = kg × preço por kg  +  frete  +  promotor
```

- **Preço por kg:** R$ 135 até 12 kg, caindo até R$ 125 a partir de 18 kg
- **Frete:** São Paulo R$ 150 · ABC R$ 200 · Osasco e Guarulhos R$ 250 ·
  outras cidades: o agente pergunta
- **Promotor:** R$ 150 por 4 horas, mais R$ 50 por hora extra, mais R$ 100 se
  a festa passar da meia-noite

Tudo isso fica numa planilha que **você edita sozinho**, sem precisar de
programador. Veja `parametros-planilha.md`.

## O resumo que só você vê

Junto do orçamento vem um bloco que **nunca vai para o cliente**:

```
Total          1.952,50
Imposto 8,5%    −165,96
Custo das balas −364,32
Frete           −200,00
Promotor        −200,00
Líquido       1.022,22   ·  piso 700  ·  ok, folga de 322,22
```

Frete e promotor entram no preço e saem como custo — margem zero neles. **Toda
a sua margem vem das balas.** Por isso, quando o cliente pede desconto, o que
está em jogo é o spread do kg.

Se o líquido ficar abaixo do seu piso, o agente avisa e diz qual seria o preço
mínimo para manter a margem. Ele nunca recusa sozinho.

## Instalação (Passo 1)

1. Crie uma planilha no Google Sheets
2. **Extensões → Apps Script** → apague tudo e cole o conteúdo de `codigo.gs`
3. Salve
4. **Implantar → Nova implantação** → tipo **App da Web**, executar como **Eu**,
   acesso **Qualquer pessoa** → copie a URL
5. Monte as abas de parâmetros seguindo `parametros-planilha.md`
   (opcional: sem as abas, o motor usa os valores atuais embutidos no código)

Para testar sem nada instalado, com Node no computador:

```bash
node testes/runner.js
```

Isso roda 37 conferências contra os valores reais das suas apresentações. Se
todas passarem, as contas estão certas.

## Arquivos

| Arquivo | O que é |
|---|---|
| `codigo.gs` | O motor — cole no Apps Script |
| `spec.md` | As regras de negócio, por escrito |
| `parametros-planilha.md` | Como montar a planilha de preços |
| `testes/casos.json` | Os casos de conferência |
| `testes/runner.js` | Roda as conferências |
| `CLAUDE.md` | Contexto técnico do projeto |

## O que vem a seguir

- **Passo 2:** a imagem do orçamento, com a cara da Fini
- **Passo 3:** o WhatsApp (BotConversa) e a leitura da sua mensagem
