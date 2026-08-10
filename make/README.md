# Cenário Make — ORCAMENTO - WhatsApp

Como montar o cenário que liga o WhatsApp ao motor de cálculo.

> **Por que uma receita e não um blueprint pronto:** as escritas na sua conta do
> Make precisam da sua aprovação, e nesta sessão ela não chegou — nem para criar,
> nem para listar os módulos disponíveis. Eu poderia ter escrito um blueprint no
> escuro, mas um arquivo com um identificador de módulo errado falha na
> importação e você perde mais tempo depurando do que montaria seguindo isto.
>
> Se você liberar a escrita no MCP do Make, eu monto o cenário direto na sua
> conta, inativo, já testado com um "Run once" — e aí sim exporto o blueprint
> para cá. Enquanto isso, esta receita é completa: todos os corpos JSON estão
> prontos para copiar.

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

## O que eu conferi e o que não

**Conferido** lendo os seus cenários e a sua conta:

- API do BotConversa: endpoints, header `API-KEY` e o corpo do `send_message`
- Data Store 128074 (`Chaves API`), key `anthropic` → campo `api_key`
- O padrão da chamada Anthropic com `output_config.format.json_schema`, que já
  roda no seu cenário da nota fiscal
- Que o seu número já é assinante do BotConversa
- Todos os valores calculados nos critérios de teste — vêm do motor, com 45
  casos passando

**Não conferido**, e por isso está marcado no texto:

- O formato exato do que a ação de webhook do BotConversa envia (o ⚠️ acima)
- Os nomes dos módulos de escrita em Data Store e do Router no seu Make
