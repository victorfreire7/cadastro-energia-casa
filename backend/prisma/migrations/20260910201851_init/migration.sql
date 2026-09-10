-- CreateTable
CREATE TABLE "Usuario" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha" TEXT NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Imovel" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "endereco" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ativo',

    CONSTRAINT "Imovel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Eletrodomestico" (
    "id" SERIAL NOT NULL,
    "imovelId" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "potenciaW" DOUBLE PRECISION NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "horasDia" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Eletrodomestico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumoHistorico" (
    "id" SERIAL NOT NULL,
    "imovelId" INTEGER NOT NULL,
    "mesReferencia" TEXT NOT NULL,
    "consumoTotalKwh" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ConsumoHistorico_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- AddForeignKey
ALTER TABLE "Imovel" ADD CONSTRAINT "Imovel_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Eletrodomestico" ADD CONSTRAINT "Eletrodomestico_imovelId_fkey" FOREIGN KEY ("imovelId") REFERENCES "Imovel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumoHistorico" ADD CONSTRAINT "ConsumoHistorico_imovelId_fkey" FOREIGN KEY ("imovelId") REFERENCES "Imovel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
