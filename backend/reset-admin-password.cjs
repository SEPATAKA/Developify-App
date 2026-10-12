
const { initializeApp, getApps, cert, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const readline = require('node:readline');

async function main() {
  const email = 'admin@developify.co.za';
  const password = await new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question('Enter a NEW admin password (minimum 12 characters): ', (value) => {
      rl.close();
      resolve(value);
    });
  });

  if (password.length < 12) {
    throw new Error('Password must be at least 12 characters.');
  }

  const app = getApps()[0] || initializeApp({
    credential: applicationDefault(),
    projectId: 'developify-5615a',
  });

  const auth = getAuth(app);
  const user = await auth.getUserByEmail(email);
  await auth.updateUser(user.uid, { password });
  console.log(`Password updated successfully for ${email}`);
}

main().catch((error) => {
  console.error('Password reset failed:', error.message);
  process.exitCode = 1;
});
