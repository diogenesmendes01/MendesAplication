import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

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
  const adminPasswordHash = await bcrypt.hash("admin123", 10);

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

  // Create sample clients for company1
  const client1 = await prisma.client.upsert({
    where: { cpfCnpj_companyId: { cpfCnpj: "12.345.678/0001-90", companyId: company1.id } },
    update: {},
    create: {
      name: "ABC Tecnologia Ltda",
      razaoSocial: "ABC Tecnologia Ltda",
      cpfCnpj: "12.345.678/0001-90",
      email: "contato@abctech.com.br",
      telefone: "(11) 3333-1001",
      type: "PJ",
      companyId: company1.id,
    },
  });

  const client2 = await prisma.client.upsert({
    where: { cpfCnpj_companyId: { cpfCnpj: "98.765.432/0001-10", companyId: company1.id } },
    update: {},
    create: {
      name: "XYZ Serviços S.A.",
      razaoSocial: "XYZ Serviços S.A.",
      cpfCnpj: "98.765.432/0001-10",
      email: "contato@xyz.com.br",
      telefone: "(11) 3333-2002",
      type: "PJ",
      companyId: company1.id,
    },
  });

  // Create additional contacts for clients
  const existingContacts = await prisma.additionalContact.findMany({
    where: { clientId: { in: [client1.id, client2.id] } },
  });

  if (existingContacts.length === 0) {
    await prisma.additionalContact.createMany({
      data: [
        {
          clientId: client1.id,
          name: "Carlos Silva",
          role: "Diretor Comercial",
          email: "carlos.silva@abctech.com.br",
          whatsapp: "5511999990001",
        },
        {
          clientId: client1.id,
          name: "Maria Santos",
          role: "Gerente de TI",
          email: "maria.santos@abctech.com.br",
          whatsapp: "5511999990002",
        },
        {
          clientId: client2.id,
          name: "João Pereira",
          role: "Coordenador Financeiro",
          email: "joao.pereira@xyz.com.br",
          whatsapp: "5511999990003",
        },
      ],
    });
  }

  // Create default SLA configs for each company
  const slaDefaults = [
    // Ticket SLAs
    { type: "TICKET" as const, priority: "HIGH" as const, stage: "first_reply", deadlineMinutes: 30, alertBeforeMinutes: 15 },
    { type: "TICKET" as const, priority: "HIGH" as const, stage: "resolution", deadlineMinutes: 240, alertBeforeMinutes: 15 },
    { type: "TICKET" as const, priority: "MEDIUM" as const, stage: "first_reply", deadlineMinutes: 120, alertBeforeMinutes: 30 },
    { type: "TICKET" as const, priority: "MEDIUM" as const, stage: "resolution", deadlineMinutes: 1440, alertBeforeMinutes: 30 },
    { type: "TICKET" as const, priority: "LOW" as const, stage: "first_reply", deadlineMinutes: 480, alertBeforeMinutes: 60 },
    { type: "TICKET" as const, priority: "LOW" as const, stage: "resolution", deadlineMinutes: 2880, alertBeforeMinutes: 60 },
    // Refund SLAs
    { type: "REFUND" as const, priority: null, stage: "approval", deadlineMinutes: 240, alertBeforeMinutes: 60 },
    { type: "REFUND" as const, priority: null, stage: "execution", deadlineMinutes: 1440, alertBeforeMinutes: 240 },
    { type: "REFUND" as const, priority: null, stage: "total", deadlineMinutes: 2880, alertBeforeMinutes: 480 },
  ];

  for (const company of [company1, company2]) {
    for (const sla of slaDefaults) {
      // Check if exists first since Prisma compound unique with null is tricky
      const existing = await prisma.slaConfig.findFirst({
        where: {
          companyId: company.id,
          type: sla.type,
          priority: sla.priority,
          stage: sla.stage,
        },
      });
      if (!existing) {
        await prisma.slaConfig.create({
          data: {
            companyId: company.id,
            type: sla.type,
            priority: sla.priority,
            stage: sla.stage,
            deadlineMinutes: sla.deadlineMinutes,
            alertBeforeMinutes: sla.alertBeforeMinutes,
          },
        });
      }
    }
  }

  console.log("Seed completed:");
  console.log(`  Companies: ${company1.nomeFantasia}, ${company2.nomeFantasia}`);
  console.log(`  Admin user: ${adminUser.email}`);
  console.log(`  Clients: ${client1.name}, ${client2.name}`);
  console.log(`  Additional contacts: 3 (for ${client1.name} and ${client2.name})`);
  console.log(`  SLA configs: ${slaDefaults.length * 2} (${slaDefaults.length} per company)`);
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
