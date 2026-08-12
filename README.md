# Cockpit Apps

Extensões simples para o [Cockpit Project](https://cockpit-project.org/).

## Docker

O primeiro app oferece uma interface enxuta para consultar e operar containers,
imagens, volumes e redes Docker sem sair do Cockpit. A interface usa JavaScript
puro, Bootstrap e Bootstrap Table carregados por CDN.

Recursos disponíveis:

- listar, buscar, iniciar, parar e reiniciar containers;
- acompanhar logs e inspecionar configurações;
- baixar, etiquetar, inspecionar e apagar imagens;
- criar, inspecionar e apagar volumes;
- criar e inspecionar redes, conectar ou desconectar containers e apagar redes.

Imagens, volumes e redes possuem propriedades imutáveis no Docker. Por isso, a
interface não simula alterações que a engine não oferece: imagens são editadas
com novas tags, redes são editadas pelas conexões, e mudanças estruturais em
volumes ou redes exigem recriação.

## Requisitos

- Linux com Cockpit instalado e em execução;
- Docker Engine e Docker CLI disponíveis no host;
- usuário autorizado a executar Docker ou a obter acesso administrativo no Cockpit;
- acesso a `cdn.jsdelivr.net` no navegador, usado pelo Bootstrap e Bootstrap Table.

Confirme os requisitos antes da instalação:

```bash
cockpit-bridge --version
docker version
```

## Instalação para todos os usuários

O Cockpit procura pacotes de sistema em `/usr/local/share/cockpit`. Clone o
repositório diretamente nesse diretório:

```bash
sudo mkdir -p /usr/local/share/cockpit
sudo git clone https://github.com/fbsis/cockpit-apps.git \
  /usr/local/share/cockpit/cockpit-apps
```

Confirme que o manifesto foi encontrado:

```bash
cockpit-bridge --packages
```

Abra o Cockpit, normalmente em `https://SERVIDOR:9090`, entre novamente na
sessão caso ela já estivesse aberta e selecione **Docker** na seção **Sistema**.

O app executa o Docker com a sessão autenticada pelo Cockpit e tenta solicitar
acesso administrativo quando necessário. Nenhum socket Docker é exposto ao
navegador.

## Atualização

```bash
sudo git -C /usr/local/share/cockpit/cockpit-apps pull --ff-only
```

Depois da atualização, recarregue o Cockpit. Se uma versão antiga continuar
aberta, encerre a sessão e entre novamente para gerar uma nova sessão do bridge.

## Remoção

Remova apenas o diretório deste pacote:

```bash
sudo rm -rf /usr/local/share/cockpit/cockpit-apps
```

Essa operação remove somente a interface. Containers, imagens, volumes e redes
Docker não são alterados.

## Desenvolvimento

Crie um link do projeto no diretório de pacotes do Cockpit:

```bash
mkdir -p ~/.local/share/cockpit
ln -s "$PWD" ~/.local/share/cockpit/cockpit-apps
```

Depois, abra o Cockpit e acesse **Docker** na seção **Sistema**. Pacotes no
diretório do usuário não usam o cache agressivo aplicado aos pacotes de sistema.

Para verificar se o pacote foi encontrado:

```bash
cockpit-bridge --packages
```

Para desfazer o link de desenvolvimento:

```bash
rm ~/.local/share/cockpit/cockpit-apps
```
