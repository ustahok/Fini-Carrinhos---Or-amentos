# Passo a passo — colocar o agente de orçamento no ar

> **Para quem for me explicar este documento:** eu sou o dono de uma empresa que
> aluga carrinhos de bala para festas (Fini Carrinhos, São Paulo). Um
> desenvolvedor montou para mim um agente que recebe um pedido de orçamento em
> texto livre e devolve o orçamento pronto, calculado. A parte de programação
> está feita. O que falta são tarefas de configuração em três ferramentas:
> **Google Apps Script**, **Telegram** e **Make.com** (antigo Integromat).
> Eu não sou programador. Por favor destrinche cada passo abaixo em detalhe,
> explicando onde clicar e o que significa cada coisa, e me avise quando um
> passo depender do anterior ter dado certo.

---

## O que o sistema faz

Eu mando uma mensagem no Telegram, tipo:

```
orçamento pra Ana, 15/09, Santo André, 100 convidados
```

E recebo de volta duas mensagens:

1. **O orçamento formatado**, com três opções de quilos de bala lado a lado,
   pronto para eu encaminhar à cliente no WhatsApp.
2. **Um bloco interno** só para mim, com o lucro líquido projetado e um aviso
   se ficou abaixo do piso de margem.

Se faltar informação (por exemplo, eu não disse o local), ele me pergunta o que
falta e completa o pedido quando eu respondo.

**Regra importante do projeto:** o modelo de IA só lê a mensagem e extrai os
parâmetros (cliente, data, local, convidados). **Nenhum valor em reais é
calculado pela IA** — todo cálculo é feito por um código determinístico,
validado por 45 testes automatizados. Isso é proposital e não deve ser mudado.

## As peças

| Peça | Papel | Estado |
|---|---|---|
| `codigo.gs` | Motor de cálculo, roda no Google Apps Script | Pronto, falta publicar |
| Cenário no Make | Recebe a mensagem, chama a IA e o motor, responde | **Já montado**, inativo |
| Bot do Telegram | Por onde eu falo com o agente | Falta criar |

## O que JÁ está pronto (não preciso mexer)

- O motor de cálculo e seus 45 testes (todos passando)
- O prompt que extrai os parâmetros da mensagem
- O cenário no Make, chamado `ORCAMENTO - WhatsApp`, **ID 5935418**, criado e
  **inativo**
- Um webhook no Make, com esta URL:
  `https://hook.us2.make.com/ymvb6h88e2yifyabpr46a7owzm8tpawh`
- Três Data Stores no Make (são tabelinhas de apoio):
  - `Orcamento - config` (ID 130848) — vazio, eu preciso preencher
  - `Orcamento - operadores autorizados` (ID 130845) — vazio, eu preciso preencher
  - `Orcamento - pedido em aberto` (ID 130846) — vazio, ele se enche sozinho
- A chave da API da Anthropic, que já existia na minha conta do Make, no Data
  Store `Chaves API` (ID 128074)

**O cenário nunca foi executado nenhuma vez.** Ele foi montado e validado
estruturalmente, mas nunca rodou de verdade. É esperado que precise de um ou
dois ajustes na primeira execução.

---

# OS PASSOS

## Passo 1 — Publicar o motor de cálculo como Web App

O arquivo `codigo.gs` está no meu computador em:
`C:\CLAUDE\Fini Carrinho - Orçamentos\codigo.gs`

O que preciso fazer:

1. Criar uma **planilha nova em branco** no Google Sheets
2. Nela, menu **Extensões → Apps Script**
3. Apagar o conteúdo que vier por padrão e **colar todo o `codigo.gs`**
4. Salvar
5. Botão **Implantar → Nova implantação**
6. Na engrenagem ao lado de "Selecionar tipo", escolher **App da Web**
7. Configurar:
   - **Executar como:** Eu (meu e-mail)
   - **Quem pode acessar:** Qualquer pessoa
8. Clicar em **Implantar** e autorizar o acesso quando o Google pedir
   (vai aparecer um aviso de "app não verificado" — é meu próprio script,
   preciso ir em "Avançado" e prosseguir)
9. **Copiar a URL do App da Web** que aparece no final. É uma URL longa que
   começa com `https://script.google.com/macros/s/...` e termina com `/exec`

**Guardar essa URL.** Vou chamar ela de `URL_DO_WEB_APP` daqui pra frente.

> **Não preciso montar nenhuma aba na planilha.** O código já vem com todos os
> preços e tabelas embutidos — são exatamente os valores que os 45 testes
> validam. A planilha em branco serve só para o script ficar vinculado a ela e
> registrar um log dos orçamentos numa aba `Orcamentos`, que ele cria sozinho na
> primeira vez.

## Passo 2 — Criar a senha SEGREDO

A URL do Web App fica aberta na internet, então o código exige uma senha em toda
chamada. Ainda dentro do editor do Apps Script:

1. Ícone de **engrenagem** na barra da esquerda (**Configurações do projeto**)
2. Rolar até **Propriedades do script**
3. **Adicionar propriedade do script**
4. Nome da propriedade: `SEGREDO` (exatamente assim, maiúsculas)
5. Valor: uma senha que eu invento (ex: `fini-2026-xyz`). Sem espaços.
6. Salvar

**Guardar essa senha.** Vou chamar ela de `MINHA_SENHA`.

> Atenção: depois de mudar propriedades do script, às vezes é preciso fazer uma
> **nova implantação** (Implantar → Gerenciar implantações → editar → Nova
> versão) para a mudança valer. Se o Passo 3 falhar, é o primeiro lugar a olhar.

## Passo 3 — Testar se o motor respondeu

No meu computador (Windows), abrir o **Git Bash** e rodar, trocando os dois
valores pelos meus:

```bash
curl -sL -X POST "URL_DO_WEB_APP" -H "Content-Type: application/json" -d '{"action":"ping","segredo":"MINHA_SENHA"}'
```

**Resposta esperada:** um texto JSON contendo `"ok":true`, `"versao":"1.1"` e,
o mais importante, `"segredo":"configurado"`.

- Se vier `"segredo":"NÃO CONFIGURADO"` → a propriedade do Passo 2 não pegou
- Se vier `"ok":false` com "Segredo inválido" → a senha que digitei não bate
- Se vier uma página HTML de login do Google → a implantação não está como
  "Qualquer pessoa" pode acessar

**Não seguir para o Passo 4 enquanto esse teste não passar.**

## Passo 4 — Criar o bot do Telegram e descobrir meu chat id

1. Abrir o Telegram e procurar o contato **@BotFather**
2. Mandar `/newbot`
3. Ele pede um nome (pode ser `Fini Orçamentos`) e depois um username, que
   **precisa terminar em `bot`** (ex: `fini_orcamentos_bot`)
4. Ele responde com um **token**, no formato `123456789:AA...`

**Guardar o token.** Vou chamar de `TOKEN_DO_BOT`. É uma senha — não devo
publicar em lugar nenhum.

Depois:

5. Procurar o contato **@userinfobot** no Telegram e mandar qualquer mensagem
6. Ele responde com o meu **Id** (um número, tipo `123456789`)

**Guardar esse número.** Vou chamar de `MEU_CHAT_ID`.

7. Por último: procurar o meu próprio bot (o username que criei acima) e mandar
   um `/start` para ele. Sem isso o Telegram não deixa o bot me mandar mensagem.

## Passo 5 — Preencher os dois Data Stores no Make

Entrar em [make.com](https://www.make.com), no menu lateral em **Data stores**.

### 5a — `Orcamento - config`

Abrir, clicar em **Browse**. Já existe um registro com a chave (key) `default`,
com os três campos vazios. Editar e preencher:

| Campo | O que colocar |
|---|---|
| `webapp_url` | a `URL_DO_WEB_APP` do Passo 1 |
| `webapp_segredo` | a `MINHA_SENHA` do Passo 2 |
| `telegram_token` | o `TOKEN_DO_BOT` do Passo 4 |

### 5b — `Orcamento - operadores autorizados`

Abrir, **Browse**, e **adicionar um registro novo**:

| Campo | O que colocar |
|---|---|
| **key** (a chave do registro) | o `MEU_CHAT_ID` do Passo 4 |
| `nome` | `William` |

> Essa tabela é o porteiro: só quem estiver nela consegue usar o agente. Para
> autorizar outra pessoa depois, é só acrescentar uma linha — não precisa mexer
> no cenário.

## Passo 6 — Ligar o Telegram ao Make

Colar isto na barra de endereço do navegador, trocando `<TOKEN_DO_BOT>` pelo meu
token do Passo 4:

```
https://api.telegram.org/bot<TOKEN_DO_BOT>/setWebhook?url=https://hook.us2.make.com/ymvb6h88e2yifyabpr46a7owzm8tpawh
```

**Resposta esperada:** `{"ok":true,"result":true,"description":"Webhook was set"}`

> Atenção ao formato: é `bot` colado no token, sem barra e sem espaço. Se o
> token é `123:ABC`, a URL fica `.../bot123:ABC/setWebhook?...`

## Passo 7 — Ativar o cenário e testar

1. No Make, abrir o cenário **`ORCAMENTO - WhatsApp`** (ID 5935418)
2. No canto inferior esquerdo tem uma chave liga/desliga (**Scheduling**).
   Ligar (ON).
3. No Telegram, mandar para o **meu bot**:

```
orçamento pra Ana, 15/09, Santo André, 100 convidados
```

**Resultado esperado:** duas mensagens de volta. A primeira com três opções de
quilos; na opção de **11,5 kg** o total tem que ser **R$ 1.952,50**. A segunda
mensagem, o bloco interno, tem que mostrar líquido **1.022,22**.

### Outros testes que valem fazer

**Teste do pedido incompleto** — mandar:

```
orçamento 12 kg em Alphaville
```

Ele deve **perguntar o valor do frete** (Alphaville está fora das cidades de
tabela). Respondo só:

```
300
```

E o total tem que fechar em **R$ 2.070,00**. Isso prova que ele guardou o pedido
em aberto e completou com a minha resposta curta.

**Teste do porteiro** — pedir para outra pessoa mandar `orçamento` para o bot.
**Nada deve acontecer.** Ela não está na lista de operadores autorizados.

---

## Se der erro

O cenário nunca rodou antes, então é bem possível que algo precise de ajuste na
primeira execução. O que fazer:

1. No Make, abrir o cenário e ir na aba **History** (Histórico)
2. Clicar na execução que falhou
3. O módulo que quebrou aparece marcado em vermelho — clicar nele para ver a
   mensagem de erro e o que entrou/saiu
4. **Tirar um print disso** e me mandar, que o desenvolvedor corrige

Os pontos mais prováveis de falhar, em ordem:

- **Módulo 3 ou 4 (`Get a record`)** — o comportamento do Make quando a chave
  não existe não pôde ser testado; já tem proteção nos dois, mas é o primeiro
  suspeito
- **Módulo 8 (chamada da IA)** — se a chave da Anthropic no Data Store
  `Chaves API` estiver vencida
- **Módulo 15 (motor de cálculo)** — se a `URL_DO_WEB_APP` ou a senha estiverem
  erradas no Data Store `Orcamento - config`
- **Módulos 13/16/17 (Telegram)** — se o token estiver errado, ou se eu não
  tiver mandado `/start` para o meu próprio bot

---

## Perguntas que talvez me façam

**"Por que Telegram e não WhatsApp?"**
O plano original era WhatsApp, pela ferramenta BotConversa que eu já uso. Mas
descobriu-se que o BotConversa não consegue mandar o texto livre da mensagem
para o Make numa tacada só — ele só captura texto se eu usar um passo de
"salvar resposta", o que transformaria meu pedido em duas rodadas de conversa em
vez de uma mensagem. Além disso, o envio de volta pelo BotConversa é só texto,
sem caminho para mandar imagem (que é a próxima fase do projeto). No Telegram
tudo isso funciona nativamente. Como esse agente é **interno** — a cliente nunca
fala com ele, eu é que encaminho o orçamento pronto pra ela no WhatsApp — o
canal que eu uso para pedir não precisa ser WhatsApp.

**"Posso pular algum passo?"**
Não. Os passos 1 a 6 são todos pré-requisito do 7. Ativar o cenário antes de
preencher os Data Stores só vai gerar erro.

**"Onde ficam as senhas?"**
Dentro do Make, no Data Store `Orcamento - config`. Nenhuma senha fica no código
do projeto, porque o repositório é público.
