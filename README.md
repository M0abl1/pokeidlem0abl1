# PokeIdle Manager — versão local

Painel PokeIdle Manager e até quatro contas do jogo rodando **somente neste computador**. Não há servidor remoto, tela remota, agente ou extensão: o painel sobe dentro do próprio aplicativo em `127.0.0.1`, com um token novo a cada abertura.

## Como abrir

1. Instale o [Node.js LTS](https://nodejs.org/).
2. Dê dois cliques em `Iniciar-local.cmd`. Na primeira vez ele instala as dependências.

Abrem duas janelas:

- **PokeIdle Local**: o painel (Gameplay, Visão Geral, Capturas e Histórico).
- **PokeIdle Local — Jogos**: as quatro contas do jogo. Clicar num treinador no painel mostra a conta dele nesta janela; **Mostrar jogo da conta selecionada** traz a janela para frente.

Fechar qualquer uma das duas encerra o aplicativo.

## Contas e perfis

- Os perfis ficam em `%APPDATA%\PokeIdle Local`, separados de qualquer outro launcher. Nenhum login existente é reaproveitado.
- Para entrar numa conta, selecione o treinador e use **Entrar no jogo (janela de login)**. As automações da conta ficam pausadas até você ativá-las.
- **Perfil ativo** (no painel ou em Ferramentas na janela de jogos) desliga uma conta: o jogo dela não é carregado e o login salvo é mantido para quando você religar.

## Funções

- Troca automática de hunt por XP medido, captura automática sem VIP, reposição de Ultra Ball e Great Potion.
- Aba **Capturas**: Pokémon que entram na conta durante a sessão, com filtros por conta, potência, espécie, score, IV, qualidade e shiny. **Nova sessão** limpa a lista.
- Sprites do PokémonDB baixados sob demanda e guardados em `%APPDATA%\PokeIdle Local\panel-data\sprites`.

## Desenvolvimento

```powershell
npm.cmd --prefix server ci
npm.cmd --prefix launcher ci
npm.cmd --prefix server test
npm.cmd --prefix launcher run local
```
