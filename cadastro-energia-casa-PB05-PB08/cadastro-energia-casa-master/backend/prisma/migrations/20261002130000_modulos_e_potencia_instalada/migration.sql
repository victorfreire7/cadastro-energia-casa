-- AlterTable (PB07/PB08): módulo selecionado (com snapshot do dataset), quantidade e potência instalada.
-- Colunas anuláveis: cenários anteriores recebem o módulo na próxima atualização.
ALTER TABLE "CenarioDimensionamento" ADD COLUMN     "moduloId" INTEGER,
ADD COLUMN     "moduloFabricante" TEXT,
ADD COLUMN     "moduloModelo" TEXT,
ADD COLUMN     "moduloPotenciaWp" DOUBLE PRECISION,
ADD COLUMN     "moduloPrecoBrl" DOUBLE PRECISION,
ADD COLUMN     "quantidadeModulos" INTEGER,
ADD COLUMN     "potenciaInstaladaKwp" DOUBLE PRECISION;
