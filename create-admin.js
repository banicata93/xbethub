require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('./models/admin');

async function createAdmin() {
    const { ADMIN_USERNAME, ADMIN_PASSWORD } = process.env;
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
        throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD must be set');
    }

    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/xbethub';
    await mongoose.connect(mongoUri);

    const admin = await Admin.findOne({ username: ADMIN_USERNAME }) || new Admin({ username: ADMIN_USERNAME });
    const wasCreated = admin.isNew;
    admin.password = ADMIN_PASSWORD;
    await admin.save();

    console.log(`Admin account ${wasCreated ? 'created' : 'updated'} successfully.`);
}

createAdmin()
    .catch(error => {
        console.error('Error creating or updating admin:', error.message);
        process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());