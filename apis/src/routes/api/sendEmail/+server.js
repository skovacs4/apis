// src/api/sendEmail.server.js
import nodemailer from "nodemailer";
import { GOOGLE_EMAIL, GOOGLE_EMAIL_PASSWORD } from "$env/static/private";

let transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    auth: {
        user: GOOGLE_EMAIL,
        pass: GOOGLE_EMAIL_PASSWORD,
    },
});

// Ensure transporter is ready (optional)
transporter.verify(function (error, success) {
    if (error) {
        console.error("Error verifying transporter:", error);
    } else {
        console.log("Email transporter ready");
    }
});

/**
 * API Route - Example Usage for POST requests
 */
export async function POST({ request }) {
    const { to, subject, text, html } = await request.json();
    console.log('inside!');

    try {
        await transporter.sendMail({ from: GOOGLE_EMAIL, to, subject, text, html });
        return new Response(JSON.stringify({ message: 'Email sent!' }), { status: 200 });
    } catch (error) {
        console.error("Error sending email:", error);
        return new Response(JSON.stringify({ error: 'Failed to send email' }), { status: 500 });
    }
}

// New GET handler
export async function GET() {
  return new Response(JSON.stringify({ message: 'Hello from GET!' }), { status: 200 });
}