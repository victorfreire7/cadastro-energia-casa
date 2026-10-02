-- AlterTable
ALTER TABLE "CenarioDimensionamento" ADD COLUMN     "armazenamento" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autonomiaHoras" DOUBLE PRECISION,
ADD COLUMN     "custoBateriaBrl" DOUBLE PRECISION NOT NULL DEFAULT 0;
