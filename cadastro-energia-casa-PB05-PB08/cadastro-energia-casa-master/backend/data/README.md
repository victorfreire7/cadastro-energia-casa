# Datasets e premissas do dimensionamento fotovoltaico

## `paineis.csv` (PB06) — módulos fotovoltaicos

Schema: `id, fabricante, modelo, potencia_wp, eficiencia_pct, preco_brl, fonte`

| Campo | Regra de validação |
| --- | --- |
| `id` | inteiro positivo, único |
| `fabricante`, `modelo`, `fonte` | obrigatórios (sem origem documentada o carregamento falha) |
| `potencia_wp` | numérico, 100–800 Wp |
| `eficiencia_pct` | numérico, 10–28 % (condição STC) |
| `preco_brl` | numérico > 0 (R$ por unidade) |

A coluna `fonte` pode ter vírgulas se estiver entre aspas. O carregamento e a validação estão em
`services/paineis.js`; nenhum módulo é fixado no código.

### Origem dos dados

- **Potência e eficiência**: datasheets dos fabricantes (valores em STC), conferidos em
  catálogos de distribuidores (solartraders.com, sun.store):
  - Canadian Solar HiKu6 CS6W-550MS — 550 Wp, 21,3 %
  - Jinko Tiger Pro JKM550M-72HL4-V — 550 Wp, 21,29 %
  - LONGi Hi-MO 5m LR5-72HPH-550M — 550 Wp, 21,3 %
  - Jinko Tiger Neo JKM575N-72HL4-BDV — 575 Wp, 22,26 %
- **Preços (`preco_brl`)**: ⚠️ **estimativas de referência** do mercado brasileiro (cerca de
  R$ 1,00–1,20 por Wp). Não foram obtidos de uma cotação real. **Substituir por cotação de
  distribuidor** (anotando data e link na coluna `fonte`) antes de usar em qualquer proposta.

## Premissas do cálculo de P_FV (PB05)

`P_FV = E_FV / (HSP × D × η)`

- **η (taxa de desempenho)** padrão **0,80**, ajustável entre 0,50 e 0,95. Faixa típica de projetos
  residenciais: 0,70–0,85. Referência: CRESESB/CEPEL, *Manual de Engenharia para Sistemas
  Fotovoltaicos* (2014) — confirmar a citação antes de usar na documentação final.
- **D (dias do mês)** padrão **30**, ajustável (inteiro, 28–31).
- HSP, E_FV, D e η precisam ser > 0; caso contrário o cálculo retorna erro (sem divisão por zero).
- O resultado é guardado com 3 casas decimais (resolução de 1 W) para não distorcer o
  `ceil()` do número de módulos (PB07).

## Seleção de módulo e potência instalada (PB07/PB08)

- **N** = ⌈(P_FV × 1000) / P_módulo⌉, mínimo de 1 módulo. O quociente é arredondado a 6 casas antes
  do `ceil` para que ruído de ponto flutuante não adicione um módulo indevido.
- **Seleção automática** (quando o usuário não escolhe): menor custo total dos módulos
  (N × preço); empate → maior eficiência → menor `id`. O usuário pode escolher qualquer módulo do
  dataset (`moduloId`); id inexistente ou inválido é rejeitado antes do cálculo.
- **P_instalada** = (N × P_módulo) / 1000 (kWp), comparada com P_FV. Alerta quando o desvio passa de
  **±10 %** (`LIMITE_ALERTA_PCT` em `services/modulos.js`): `folga` (acima) ou `deficit` (abaixo).
  Como N usa `ceil`, o déficit só aparece se N for alterado fora do fluxo normal.
- O cenário guarda um snapshot do módulo (fabricante, modelo, potência e preço), de modo que
  mudanças futuras no CSV não alteram propostas já salvas.
- API: `GET /dimensionamento/modulos?potenciaFvKwp=2.13` devolve todas as opções já calculadas.
