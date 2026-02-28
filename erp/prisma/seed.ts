import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Create 2 sample companies
  const company1 = await prisma.company.upsert({
    where: { cnpj: "11.222.333/0001-44" },
    update: {},
    create: {
      razaoSocial: "Mendes Tecnologia Ltda",
      nomeFantasia: "Mendes Tech",
      cnpj: "11.222.333/0001-44",
      inscricaoEstadual: "123456789",
      endereco: "Rua das Flores, 100 - São Paulo, SP",
      telefone: "(11) 99999-0001",
      email: "contato@mendestech.com.br",
      segmento: "Tecnologia",
      status: "ACTIVE",
    },
  });

  const company2 = await prisma.company.upsert({
    where: { cnpj: "55.666.777/0001-88" },
    update: {},
    create: {
      razaoSocial: "Mendes Consultoria e Serviços Ltda",
      nomeFantasia: "Mendes Consultoria",
      cnpj: "55.666.777/0001-88",
      inscricaoEstadual: "987654321",
      endereco: "Av. Paulista, 2000 - São Paulo, SP",
      telefone: "(11) 99999-0002",
      email: "contato@mendesconsultoria.com.br",
      segmento: "Consultoria",
      status: "ACTIVE",
    },
  });

  // Create 1 admin user with a bcrypt-hashed password ("admin123")
  // Hash generated for "admin123" using bcrypt with 10 rounds
  const adminPasswordHash =
    "$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36PQm2Pro7QNGGmuTGGtiU2";

  const adminUser = await prisma.user.upsert({
    where: { email: "admin@mendeserp.com.br" },
    update: {},
    create: {
      name: "Administrador",
      email: "admin@mendeserp.com.br",
      passwordHash: adminPasswordHash,
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  // Assign admin to both companies with all modules
  const allModules = [
    "DASHBOARD",
    "COMERCIAL",
    "SAC",
    "FINANCEIRO",
    "FISCAL",
    "CONFIGURACOES",
  ];

  await prisma.userCompany.upsert({
    where: {
      userId_companyId: {
        userId: adminUser.id,
        companyId: company1.id,
      },
    },
    update: {},
    create: {
      userId: adminUser.id,
      companyId: company1.id,
      modules: allModules,
    },
  });

  await prisma.userCompany.upsert({
    where: {
      userId_companyId: {
        userId: adminUser.id,
        companyId: company2.id,
      },
    },
    update: {},
    create: {
      userId: adminUser.id,
      companyId: company2.id,
      modules: allModules,
    },
  });

  console.log("Seed completed:");
  console.log(`  Companies: ${company1.nomeFantasia}, ${company2.nomeFantasia}`);
  console.log(`  Admin user: ${adminUser.email}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
