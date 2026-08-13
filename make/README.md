# Cenário Make — ORCAMENTO - WhatsApp

Como montar o cenário que liga o WhatsApp ao motor de cálculo.

> **O cenário já existe na conta.** Foi criado em 13/08/2026 com as escritas
> liberadas: cenário **5935418 `ORCAMENTO - WhatsApp`**, **inativo**, e o
> blueprint está em `make/orcamento-whatsapp.blueprint.json`. Todos os
> identificadores de módulo foram conferidos na conta antes de criar, e a Make
> aceitou os 17 módulos sem erro (`isinvalid: false`).
>
> **O desenho mudou em dois pontos** em relação à receita abaixo — leia
> "Estado atual" no fim deste arquivo antes de seguir os passos ao pé da letra.
> A receita continua válida como descrição da lógica; o que mudou foi o canal de
> entrada (Telegram, não BotConversa) e de onde vêm os segredos.

## Antes de tudo

Três coisas que precisam existir primeiro.

### 1. Publicar o Web App do Apps Script

Cole `codigo.gs` no Apps Script da planilha, **Implantar → Nova implantação →
App da Web** (executar como *Eu*, acesso *Qualquer pessoa*) e guarde a URL.

Depois, no editor do Apps Script: **Configurações do projeto → Propriedades do
script → Adicionar**, chave `SEGREDO`, valor uma senha qualquer que você invente.
Essa senha vai em toda chamada; sem ela, a URL fica aberta para quem a tiver.

Teste antes de seguir:

```bash
curl -sL -X POST "SUA_URL_DO_WEB_APP" \
  -H 'Content-Type: application/json' \
  -d '{"action":"ping","segredo":"SEU_SEGREDO"}'
```

Deve responder `{"ok":true,"versao":"1.1",...,"segredo":"configurado"}`. Se vier
`NÃO CONFIGURADO`, a propriedade não foi salva.

### 2. Dois Data Stores

**Make → Data stores → Add**

| Nome | Campos (Data structure) |
|---|---|
| `Orcamento - operadores autorizados` | `nome` (text) |
| `Orcamento - pedido em aberto` | `pedido` (text) · `atualizado_em` (text) · `ultima_mensagem` (text) |

Na aba **Browse** de `operadores autorizados`, acrescente um registro com
**key = seu telefone só com números** (ex: `5511999913164`) e `nome` = `William`.
Quem não estiver nessa lista não dispara o agente. É só acrescentar uma linha
para autorizar mais alguém — não precisa mexer no cenário.

### 3. O webhook

**Make → Webhooks → Add → Custom webhook**, nome `Orcamento WhatsApp`.
Copie a URL — ela vai no BotConversa.

## O cenário, módulo a módulo

### 1 · Webhook `Custom webhook`
Selecione o webhook criado acima.

### 2 · Tools → `Set multiple variables`
Chamar de **"Normaliza o que o BotConversa mandou"**. Como eu não pude testar o
formato exato do webhook do BotConversa daqui, cada variável tenta vários nomes
de campo e fica com o primeiro que vier preenchido. Na primeira execução real
você vê qual pegou.

| Variável | Valor |
|---|---|
| `telefone` | `{{replace(ifempty(1.telefone; ifempty(1.phone; ifempty(1.subscriber_phone; ""))); "/[^0-9]/g"; emptystring)}}` |
| `mensagem` | `{{ifempty(1.mensagem; ifempty(1.message; ifempty(1.texto; ifempty(1.text; ""))))}}` |
| `nome` | `{{ifempty(1.nome; ifempty(1.name; ifempty(1.full_name; "")))}}` |

### 3 · Data store → `Get a record`
Store `Orcamento - operadores autorizados`, key `{{2.telefone}}`.
**Marque "Don't stop on missing record"** — sem isso o cenário dá erro em vez de
seguir quando o telefone não é de operador.

**No módulo seguinte, ponha um filtro:** `{{3.nome}}` *exists*.
É aqui que o pedido de uma cliente para de andar. Ela continua no atendimento
normal do bot; o agente simplesmente não responde.

### 4 · Data store → `Get a record`
Store `Orcamento - pedido em aberto`, key `{{2.telefone}}`, também com
"Don't stop on missing record". É o que faz um "300" solto completar o pedido
anterior em vez de virar um pedido novo.

### 5 · Data store → `Get a record`
Store `Chaves API` (o 128074 que você já tem), key `anthropic`.

### 6 · HTTP → `Make a request` — o extrator

- URL `https://api.anthropic.com/v1/messages`, método **POST**
- Headers: `x-api-key` = `{{5.api_key}}` · `anthropic-version` = `2023-06-01`
- Body type **Raw**, content type **JSON**, **Parse response ligado**

```json
{
  "model": "claude-opus-5",
  "max_tokens": 2000,
  "output_config": {
    "effort": "low",
    "format": { "type": "json_schema", "schema": {{{cole extrator/schema.json}}} }
  },
  "system": "{{cole extrator/prompt.md, a partir de 'System prompt'}}",
  "messages": [{
    "role": "user",
    "content": "DATA_DE_HOJE: {{formatDate(now; \"DD/MM/YYYY\")}}\n\nPEDIDO_PENDENTE:\n{{ifempty(4.pedido; \"NENHUM\")}}\n\nMENSAGEM:\n{{2.mensagem}}"
  }]
}
```

O `effort: low` é proposital: extração não precisa de raciocínio, e sem margem
para raciocinar o modelo não tenta "ajudar" inventando um valor.

### 7 · Tools → `Set variable`
Nome `extraido`, valor
`{{join(map(6.data.content; "text"; "type"; "text"); emptystring)}}` — é o mesmo
recorte que o seu cenário da nota fiscal já usa para pegar o JSON da resposta.

### 8 · Router
Duas rotas.

**Rota A — falta alguma coisa.** Filtro: `{{length(7.extraido.faltando)}}` *greater than* `0`

- **Data store → Add/replace a record** em `pedido em aberto`:
  key `{{2.telefone}}`, `pedido` = `{{7.extraido}}`,
  `atualizado_em` = `{{now}}`, `ultima_mensagem` = `{{2.mensagem}}`
- **HTTP → Make a request** para o BotConversa (ver *Como responder* abaixo),
  com o texto: `Faltou: {{join(7.extraido.faltando; ", ")}}. Me manda que eu fecho.`

**Rota B — está completo.** Filtro: `{{length(7.extraido.faltando)}}` *equal to* `0`

- **Data store → Delete a record** em `pedido em aberto`, key `{{2.telefone}}`
- **HTTP → Make a request** no Web App:

```json
{
  "action": "orcarWhatsApp",
  "segredo": "SEU_SEGREDO",
  "origem": "whatsapp",
  "pedido": {{7.extraido}}
}
```

  A resposta traz `texto_cliente` e `texto_interno` prontos. Se vier
  `ok: false`, o campo `pergunta` já é a frase a mandar de volta (é o caso do
  frete de cidade fora das faixas).

- **HTTP** → BotConversa com `texto_cliente`
- **HTTP** → BotConversa com `texto_interno`

Duas mensagens, de propósito: a primeira sai limpa para você encaminhar à
cliente sem precisar apagar nada.

## Como responder pelo BotConversa

Dois passos, os mesmos que o seu cenário "Envio Cardápio" já usa.

**Pegar o id do assinante** — `GET`, parse response ligado:

```
https://backend.botconversa.com.br/api/v1/webhook/subscriber/get_by_phone/{{2.telefone}}/
Headers: accept: application/json · API-KEY: {{sua chave}}
```

**Mandar a mensagem** — `POST`:

```
https://backend.botconversa.com.br/api/v1/webhook/subscriber/{{id}}/send_message/
Headers: accept: application/json · API-KEY: {{sua chave}} · Content-Type: application/json
Body: {"type":"text","value":"{{o texto}}"}
```

A chave da API do BotConversa você já tem nos módulos do cenário
"Envio Cardápio - Clickup -> BotConversa". Vale copiá-la para o Data Store
`Chaves API` com a key `botconversa`, para ela existir num lugar só.

## No BotConversa

1. **Fluxos → novo fluxo** `Orçamento interno`
2. Gatilho: **palavra-chave** `orçamento` (e `orcamento` sem cedilha)
3. Primeira ação: **Requisição HTTP / Webhook** → a URL do webhook do Make,
   enviando telefone, nome e o texto da mensagem
4. Nenhuma outra ação — quem responde é o Make

⚠️ **Este é o único ponto que eu não consegui validar daqui.** Se a ação de
webhook do BotConversa não mandar o texto livre da mensagem (só avisar que o
gatilho disparou), o desenho muda: seria preciso uma etapa "salvar resposta" num
campo do assinante antes de chamar o webhook. Confira isso primeiro — é o que
decide se o resto funciona como está.

## Ordem de teste

1. `curl` do `ping` → confirma Web App e segredo
2. **Run once** no Make + mandar `orçamento pra Ana, 15/09, Santo André, 100
   convidados` no WhatsApp → confere se o webhook chega e o que ele traz
3. Deixar rodar inteiro → você deve receber as três opções com total
   **R$ 1.952,50** na de 11,5 kg, e o bloco interno com líquido **1.022,22**
4. Mandar `orçamento 12 kg em Alphaville` → ele pergunta o frete; responda `300`
   e o total deve fechar em **R$ 2.070,00**
5. Pedir para alguém de fora escrever `orçamento` → **nada deve acontecer**

## Estado atual (13/08/2026)

### A dúvida do BotConversa foi respondida — e mudou o canal

O ⚠️ acima era real. Na documentação do BotConversa, a única forma de capturar
texto livre é o elemento **"Salvar resposta"**, que pausa o fluxo e grava num
**campo personalizado** do assinante. Não existe variável de sistema com "a
última mensagem"; o bloco de integração só envia campos que já existem no
assinante, e o gatilho por palavra-chave não carrega o texto que veio junto.

Ou seja: pelo BotConversa não dá para mandar `orçamento pra Ana, 15/09, Santo
André, 100 convidados` **em uma mensagem só** — vira duas rodadas. E o envio de
volta verificado (`{"type":"text","value":…}`) é só texto, sem caminho conferido
para a imagem da Parte 2.

Por isso a entrada é **Telegram**: entrega o texto livre numa mensagem só, e
`sendPhoto` é nativo, então a Parte 2 já nasce destravada. O agente é interno —
o cliente nunca fala com ele, o Will encaminha o orçamento pelo WhatsApp como
sempre. Voltar para o BotConversa depois é barato: o gatilho é um Custom webhook
genérico e o módulo 2 já aceita `telefone`/`mensagem`/`nome` além do formato do
Telegram.

### Correções nos identificadores de módulo

Conferidos com `app-modules_list` e contra blueprints reais da conta. Dois
estavam errados na receita acima e teriam quebrado a importação:

| Peça | Identificador correto | Versão |
|---|---|---|
| Custom webhook | `gateway:CustomWebHook` | 1 |
| Data store · get | `datastore:GetRecord` | 1 |
| Data store · add/replace | `datastore:AddRecord` (**não** `AddReplaceRecord`) | 1 |
| Data store · delete | `datastore:DeleteRecord` | 1 |
| Set multiple variables | `util:SetVariables` | 1 |
| HTTP request | `http:MakeRequest` (**não** `http:ActionSendData`) | 4 |
| Parse JSON | `json:ParseJSON` | 1 |
| Router | `builtin:BasicRouter` | 1 |

Também não existe checkbox "Don't stop on missing record" em
`datastore:GetRecord` — o módulo só tem `key` e `returnWrapped`.

### O que foi criado na conta

| Recurso | ID |
|---|---|
| Cenário `ORCAMENTO - WhatsApp` (inativo) | 5935418 |
| Webhook `Orcamento WhatsApp` | 2687739 |
| Data Store `Orcamento - operadores autorizados` | 130845 |
| Data Store `Orcamento - pedido em aberto` | 130846 |
| Data Store `Orcamento - config` | 130848 |
| Data structure `Orcamento - pedido extraido` | 457735 |

### Segredos ficam no Make, nunca no blueprint

Este repositório é **público**. Nenhuma URL, senha ou token entra em
`orcamento-whatsapp.blueprint.json` — o cenário lê tudo em runtime do Data Store
`Orcamento - config` (130848), registro key `default`, criado vazio:

| Campo | O que pôr |
|---|---|
| `webapp_url` | URL da implantação do Web App do Apps Script |
| `webapp_segredo` | o mesmo valor da Script Property `SEGREDO` |
| `telegram_token` | token do bot, do BotFather |

A chave da Anthropic continua vindo do Data Store 128074 (`Chaves API`), key
`anthropic` — que já existia.

### Sobre aspas e quebras de linha

O texto do operador e o pedido pendente entram dentro de uma string JSON no
corpo da chamada Anthropic. Em vez de escapar, o módulo 2 **normaliza**: aspas
viram apóstrofo e quebras de linha viram espaço. Não perde nada para extração de
parâmetros e o corpo nunca quebra. As respostas ao Telegram vão como
`application/x-www-form-urlencoded`, então o texto do orçamento (multilinha, com
`R$` e acentos) não precisa de escape nenhum.

### O que falta para o teste ponta a ponta

Nada disso eu consigo fazer daqui:

1. **Publicar o Web App** e definir a Script Property `SEGREDO` (conta Google sua)
2. **Criar o bot** no BotFather e pegar o token
3. Preencher os três campos do `Orcamento - config`
4. Apontar o Telegram para o webhook:
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://hook.us2.make.com/ymvb6h88e2yifyabpr46a7owzm8tpawh`
5. Acrescentar em `Orcamento - operadores autorizados` um registro com
   **key = seu chat id do Telegram** e `nome` = `William`
6. Ativar e rodar a "Ordem de teste" acima

O **Run once não foi executado**: a ativação do cenário foi barrada pelo
classificador de permissões desta sessão, e de qualquer forma os passos 1–5
acima são pré-requisito. O que está verificado é que a Make aceitou o blueprint
inteiro, com todos os módulos existentes e configuração válida.
