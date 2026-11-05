# Counter Block

FPS tático 3D multiplayer para navegador, com o mapa original **Dust Block**, personagens low-poly e servidor Node.js autoritativo. O mesmo processo Express entrega o cliente Three.js e mantém as partidas Socket.io. Não é necessário instalar o jogo nos computadores dos amigos.

## Executar no Windows, macOS ou Linux

Instale **Node.js 20 ou superior**. Na pasta do projeto, abra o PowerShell ou um terminal:

```bash
npm install
npm start
```

Abra **http://localhost:3000** em um navegador desktop com WebGL e mouse. O cliente usa dependências servidas pelo próprio servidor; não depende de CDN durante uma partida. Clique em **Jogar**, informe um nickname e crie ou entre em uma sala. O nickname e as configurações ficam salvos localmente no navegador.

`PORT` escolhe a porta. Exemplo no PowerShell:

```powershell
$env:PORT = '3001'
npm start
```

No Linux/macOS:

```bash
PORT=3001 npm start
```

O processo lê as variáveis do ambiente. `.env.example` é uma referência; não há carregamento automático de arquivos `.env`.

## Jogar com amigos

1. Abra o **mesmo endereço do servidor** em todos os computadores.
2. O primeiro jogador cria uma sala e copia o código de cinco letras.
3. Os amigos usam **Entrar em sala** e informam o código.
4. Escolham T ou CT, até cinco pessoas por equipe. Cada jogador marca **Pronto**.
5. O host inicia a partida. Também é possível iniciar sozinho para explorar o mapa e treinar o objetivo; não há bots.
6. Após uma eliminação, o jogador acompanha um aliado até o próximo round. As setas alternam o aliado observado.

O código identifica uma sala dentro daquele servidor: **o código sozinho não conecta computadores a servidores diferentes**. `localhost` sempre aponta para o próprio computador. Na mesma rede, os amigos podem abrir o IP local do computador servidor, com a porta configurada e liberada no firewall. Para jogar pela internet, hospede o processo em um serviço público conforme a seção de deploy.

O host é transferido quando ele desconecta. A sessão usa um token aleatório privado em `sessionStorage`: uma queda de conexão ou atualização da mesma aba pode recuperar o jogador por até **20 segundos**. Se ele estava vivo, retorna como espectador até o próximo round. Não compartilhe esse token. Depois do prazo, o slot é removido; salas vazias são limpas. **Sair da partida** libera o slot imediatamente.

## Controles

| Comando | Ação |
| --- | --- |
| W A S D | Mover |
| Mouse | Olhar |
| Espaço | Pular; novos saltos exigem soltar e pressionar novamente |
| Shift | Andar silenciosamente |
| Ctrl | Agachar |
| Mouse 1 | Atirar / arremessar utilitário equipado |
| Mouse 2 | Alternar burst da Glock-18 ou mira da AWP |
| R | Recarregar |
| B | Abrir ou fechar compra |
| E, segurado | Plantar ou desarmar |
| 1 / 2 / 3 | Arma principal / pistola / utilitário disponível |
| 4 / 5 | Arremessar smoke / flashbang comprada |
| G | Soltar a bomba |
| Tab, segurado | Placar |
| Esc | Liberar mouse e abrir pausa |
| Setas esquerda / direita | Alternar aliado no modo espectador |

Clique em **Entrar em combate** ou **Retomar** para capturar o mouse. A captura depende de uma interação do usuário; o navegador pode recusá-la quando a página está dentro de um frame sem a permissão apropriada. Não há versão para controles de toque.

## Regras implementadas

- Salas independentes com códigos únicos, até dez jogadores e cinco por lado, nickname, host, equipes, pronto e início com poucos jogadores.
- Física compartilhada em passo fixo de 60 Hz: aceleração, atrito, inércia, frenagem na direção oposta, controle aéreo, salto, agachamento, caminhada silenciosa, colisões, pequenos degraus e rampa.
- Predição local, reconciliação com comandos reconhecidos, interpolação de jogadores remotos com buffer de 100 ms e snapshots de 20 Hz.
- Disparos calculados no servidor por raios contra cabeça, tronco, braços e pernas. Paredes, caixas, chão e rampas bloqueiam os tiros. Vida, colete, capacete, kills, deaths, assistências e recompensas são autoritativos.
- Glock-18 semiautomática/burst, USP-S, AK-47, M4A4 e AWP, com modelos geométricos originais, munição, cadência, recarga, padrões de recuo e dispersão conforme velocidade e estado aéreo.
- Smoke com arremesso, ricochetes e fumaça por 15 segundos. Flashbang com tempo, direção do olhar, distância e obstrução por paredes. Há opção para reduzir a intensidade visual da flash.
- Bomba carregável, soltável e recuperável por T; plantio nos sites A/B e desarme por CT com progresso cancelado quando a interação é interrompida.
- Rounds de 115 segundos; bomba de 40 segundos; plantio de 3,5 segundos; desarme de 7 segundos ou 3,5 com kit; compra nos primeiros 15 segundos e apenas na própria base.
- Todos os T mortos **depois** do plantio deixam a bomba ativa. Sem bomba plantada, eliminar todos os T dá vitória aos CT. Eliminar todos os CT dá vitória aos T.
- Partida de até 12 rounds, encerrada antes se uma equipe alcançar sete vitórias; 6 × 6 é empate. Os lados são alternados após seis rounds. O host pode reiniciar uma partida concluída.
- Economia inicial de $800, compras e saldo validados no servidor, recompensas por eliminação, assistência, vitória, derrota e plantio/desarme. Equipamentos de sobreviventes são preservados entre rounds, exceto na troca de lados. Carregadores e reservas das armas de fogo são repostos automaticamente no início de cada round, sem custo adicional.
- HUD, placar, kill feed, compra, pausa, configurações, radar de aliados e sites, áudio sintetizado original e personagens remotos articulados.

Nas configurações é possível ajustar sensibilidade, volumes, FOV, qualidade, escala de renderização, contador de FPS e intensidade reduzida da flash. A qualidade controla sombras e detalhes, e a resolução tem limite de pixel ratio para reduzir o custo da renderização.

## Testar

```bash
npm test
npm run check
```

Os testes usam `node:test`. As integrações abrem um servidor HTTP real e múltiplos clientes `socket.io-client` por WebSocket, com relógio de simulação controlado para verificar os tempos sem esperar rounds completos.

A suíte cobre salas e códigos, lotação, equipes, permissões do host, pronto, início solo, snapshots para dois clientes, comandos inválidos e antigos, velocidade, compra, tiros/cadência/munição/recarga, dano/headshot/obstruções, eliminações, bomba/plantio/cancelamento/desarme/kit, fim e reinício de rounds, troca de lados, reconexão, transferência de host e limpeza. Há testes de física, smoke, flash, interpolação, menus DOM, correspondência da geometria do mapa e descarte dos recursos 3D.

O teste de integração do cliente executa o módulo `game.js` real e seus menus contra o servidor Socket.io real: cria sala, inicia, move o personagem, compra, troca equipamento, fecha a loja e sai. Esse teste adapta as fronteiras de DOM, canvas, renderizador e captura de mouse; ele verifica a integração de código, sem desenhar pixels na GPU.

Para uma conferência manual, abra uma janela normal e uma janela anônima, entre na mesma sala e use nicknames diferentes. Inicie os dois lados, atravesse o mapa, teste tiros, compra, bomba e a passagem ao round seguinte. Janelas separadas permitem sessões independentes; a captura de mouse só controla a janela em foco.

**Limite desta entrega:** os testes de servidor e física foram executados com clientes Socket.io reais. Não houve validação de renderização nem de Pointer Lock com dois navegadores reais neste ambiente, que não disponibilizou a rota de controle de navegador exigida pelo fluxo de preview. A meta de 60 FPS depende do hardware e ainda precisa de benchmark em computadores reais.

## Arquitetura

```text
counter-block/
├── package.json
├── server.js                 # HTTP, Socket.io, salas, limites de eventos e execução
├── server/
│   ├── game.js               # Regras autoritativas, combate, economia, bomba e rounds
│   └── grenades.js           # Física e efeitos de granadas no servidor
├── shared/
│   ├── config.js             # Tempos e regras
│   ├── physics.js            # Movimento, colisões, raios e hitboxes sem DOM
│   ├── map-data.js           # Geometria, zonas e spawns originais
│   └── weapons.js            # Arsenal, preços e configurações
├── public/
│   ├── index.html
│   ├── style.css
│   ├── game.js               # Integração, entrada, predição e renderização
│   ├── map.js
│   ├── weapons.js
│   ├── player.js
│   ├── networking.js
│   ├── ui.js
│   └── audio.js
├── tests/
└── render.yaml
```

O navegador envia comandos numerados de movimento, orientação e ações; não escolhe posição, dinheiro, alvos atingidos ou resultados. O servidor avança cada jogador em ticks limitados, mantém fila limitada, descarta comandos antigos e valida as transições. Eventos Socket.io têm limites de frequência e tamanho de pacote.

A compensação de latência consulta um histórico limitado de posições. O recuo máximo é de **200 ms**, limitado também pelo RTT medido mais uma margem. Não há promessa de compensação perfeita para ping alto. A arquitetura reduz formas simples de trapaça; não substitui auditoria de segurança ou anticheat completo. Os estados enviados aos clientes incluem inventários e posições dos jogadores, portanto não há filtragem contra wallhack no protocolo.

O servidor é **persistente enquanto o processo está em execução**, com salas em memória. Não há banco de dados de contas, ranking, retomada após reinício do processo, matchmaking público, voz, sistema de demos ou bots. A implementação deve rodar em **uma única instância Node.js**. Redis Adapter sozinho não distribui a simulação: múltiplas réplicas exigem roteamento de salas e um proprietário autoritativo por partida.

## Deploy em Node.js com WebSockets persistentes

Nenhuma publicação externa foi realizada. O projeto inclui `render.yaml` como ponto de partida para o Render.

### Render

1. Envie este repositório para um provedor Git da sua escolha.
2. No Render, crie um **Web Service** Node.js a partir do repositório, ou use o Blueprint de `render.yaml`.
3. Selecione a pasta que contém `package.json` como diretório raiz, quando o repositório tiver uma pasta externa.
4. Build: `npm ci`. Start: `npm start`. Health check: `/health`.
5. Deixe a plataforma definir `PORT`; o servidor escuta em `0.0.0.0`.
6. Use uma única instância e um plano com processo contínuo para sessões estáveis. Se a hospedagem suspender ou reiniciar o processo, as salas serão perdidas.
7. Compartilhe o endereço HTTPS final e, depois, o código da sala.

### Railway

Crie um projeto a partir do repositório e configure o diretório raiz correto, build `npm ci`, start `npm start` e health check `/health`. Gere um domínio público, mantenha uma réplica e confirme que as conexões WebSocket chegam ao mesmo processo. Use o `PORT` fornecido pela plataforma.

Em um proxy próprio, encaminhe HTTP e o upgrade WebSocket de `/socket.io/` para o mesmo processo, com tempo de conexão suficiente. Use HTTPS no endereço público para as APIs seguras do navegador, como a cópia para a área de transferência. O cliente possui uma alternativa para copiar o código quando essa API não está disponível.

`ALLOWED_ORIGIN` é opcional e aceita origens separadas por vírgula para a configuração CORS do Socket.io. Não é um mecanismo de autenticação nem impede clientes WebSocket próprios. Por padrão, cliente e servidor usam a mesma origem.

Hospedagem puramente estática ou funções serverless convencionais não mantêm esta simulação e suas salas. Não publique apenas `public/`: o processo Node.js faz parte do jogo.

## Assets e propriedade

A geometria do mapa, modelos e sons sintetizados foram criados para este projeto. Nenhum arquivo, mapa, textura, áudio ou modelo proprietário de Counter-Strike foi incluído. Os nomes das classes de armas identificam a configuração do arsenal; os modelos visuais são originais. As bibliotecas externas mantêm suas próprias licenças.
