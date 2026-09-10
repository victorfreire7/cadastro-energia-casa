# SERS Imobiliário — Documentação de Arquitetura

> Documento de brainstorm. Decisões aqui são o ponto de partida — qualquer parte pode ser revista antes da implementação.

## 1. Visão Geral

Sistema para cadastro de imóveis e eletrodomésticos, com cálculo e histórico de consumo de energia (kWh). Baseado no Product Backlog (PB01–PB09) já documentado em `Backlog Projeto SERS.docx`.

## 2. Stack Tecnológica

| Camada | Tecnologia | Observação |
| --- | --- | --- |
| Backend | Node.js + Express | API REST própria |
| ORM | Sequelize | Acesso ao Postgres via models/migrations |
| Banco de dados | Supabase (Postgres) | Conexão direta via connection string, não via `supabase-js` |
| Frontend | React (SPA) | Consome só a nossa API, não fala com o Supabase diretamente |

**Fluxo de comunicação:**

```
React (frontend) --HTTP/JSON--> Express (backend) --Sequelize--> Postgres (Supabase)
```

## 3. Estrutura de Pastas

```
cadastro-energia-casa/
├── backend/
│   ├── src/
│   │   ├── models/        # Models Sequelize (Usuario, Imovel, Eletrodomestico, Consumo)
│   │   ├── controllers/    # Lógica de cada rota
│   │   ├── routes/         # Definição das rotas Express
│   │   ├── middlewares/     # Autenticação, validação, tratamento de erro
│   │   ├── config/          # Configuração do Sequelize/conexão
│   │   └── app.js
│   ├── .env                # Variáveis de ambiente (não versionado)
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/        # Chamadas à API (axios/fetch)
│   │   └── App.jsx
│   └── package.json
├── Backlog Projeto SERS.docx
├── readme.md                # Integrantes do grupo
└── ARQUITETURA.md           # Este arquivo
```

## 4. Variáveis de Ambiente (backend)

```
DATABASE_URL=postgresql://usuario:senha@host:5432/postgres
JWT_SECRET=
PORT=3000
```

> **Decisão:** conexão direta, porta 5432 (sem pooler). O pooler do Supabase (6543) existe para resolver esgotamento de conexões em ambientes serverless, que não é o caso aqui — o backend é um servidor Express de longa duração.

## 5. Modelagem de Dados (aprovada)

Baseado nos PBs do backlog.

- **Usuario**: id, nome, email, senha (hash)
- **Imovel**: id, usuario_id (FK), endereço, tipo, status (ativo/inativo)
- **Eletrodomestico**: id, imovel_id (FK), nome, potencia_w, quantidade, horas_dia
- **ConsumoHistorico**: id, imovel_id (FK), mes_referencia, consumo_total_kwh

Relações: Usuario 1:N Imovel; Imovel 1:N Eletrodomestico; Imovel 1:N ConsumoHistorico.

Ajustes futuros (campos/relações) serão feitos via migrations do Sequelize, sem precisar recriar o banco do zero.

## 6. Mapeamento Backlog → Módulos da API

| PB | Módulo | Rota base (proposta) |
| --- | --- | --- |
| PB01, PB02 | Autenticação | `/auth` |
| PB03, PB04, PB05 | Imóveis | `/imoveis` |
| PB06, PB07 | Consumo | `/imoveis/:id/consumo` |
| PB08 | Validação | Middleware transversal (não é rota própria) |
| PB09 | Segurança | Middleware de autenticação/autorização |

## 7. Pontos em aberto (para não alucinar)

Nenhum no momento. Todas as decisões abaixo foram fechadas:

- Conexão Supabase: direta, porta 5432 (seção 4)
- Cadastro sem confirmação de email — não consta no backlog (PB01 pede só nome/email/senha)

## 8. Próximos Passos

1. Criar migrations do Sequelize
2. Estruturar rotas base do Express
3. Scaffold inicial do React (Create React App / Vite — a decidir)
