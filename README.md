# EduBoom CRM Render Ready

This is the real cloud version.

It has:
- Node.js + Express backend
- PostgreSQL database
- Login system
- Sessions
- Kevin's Academy demo account
- 150 demo students
- ESL, IELTS, CEFR courses
- Leads, students, payments, teachers, reports
- Teacher salary calculated from student payments
- Shared data from any device after login

## Demo logins

Password for all demo users:

```txt
Kevin2026!
```

Emails:

```txt
owner@kevins.demo
manager@kevins.demo
reception@kevins.demo
teacher@kevins.demo
accountant@kevins.demo
```

## Deploy to Render

1. Upload this project to a GitHub repository.
2. Go to Render.
3. Create a PostgreSQL database.
4. Create a Web Service from your GitHub repo.
5. Build command:

```bash
npm install
```

6. Start command:

```bash
npm start
```

7. Add environment variables:

```txt
DATABASE_URL=your_render_postgres_external_or_internal_database_url
SESSION_SECRET=make-a-long-random-secret
DEMO_SEED=true
NODE_ENV=production
```

8. Deploy.

When the app starts for the first time, it creates the tables and seeds Kevin's Academy demo data automatically.

## Domain

In Render Web Service settings, add your custom domain, for example:

```txt
crm.uboom.uz
```

Then add the DNS record Render gives you in your domain DNS panel.

Do not upload only `public/index.html` to GitHub Pages. This project needs the backend and PostgreSQL.
