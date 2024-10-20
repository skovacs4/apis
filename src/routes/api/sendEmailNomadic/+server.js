import nodemailer from "nodemailer";
import { EMAIL, EMAIL_PASSWORD } from "$env/static/private";

// Create transporter with authentication details
let transporter = nodemailer.createTransport({
    host: "mail.thenomadicdigital.com",
    port: 587,
    auth: {
        user: EMAIL,
        pass: EMAIL_PASSWORD,
    },
});

// Verify transporter setup (optional)
transporter.verify(function (error, success) {
    if (error) {
        console.error("Error verifying transporter:", error);
    } else {
        console.log("Email transporter ready");
    }
});

/**
 * API Route - Handle POST requests to send emails
 */
export async function POST({ request }) {
    const requestBody = await request.json();

    const { to, subject, text, html, fromDisplayName } = requestBody;

    // Set sender dynamically based on request parameters
    var sender = "";

    if (fromDisplayName && fromDisplayName.trim() !== "") {
        sender = `"${fromDisplayName}" <${EMAIL}>`;
    } else {
        // Fallback display name if fromDisplayName is not provided or empty
        sender = `"Contact" <${EMAIL}>`;
    }

    try {
        // Send email using the configured transporter with dynamic sender
        await transporter.sendMail({ from: sender, to, subject, text, html });

        // Set CORS headers to allow all origins
        const headers = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        };

        // Return success response
        return new Response(JSON.stringify({ message: 'Email sent!' }), { status: 200, headers });
    } catch (error) {
        console.error("Error sending email:", error);

        // Return error response
        return new Response(JSON.stringify({ error: 'Failed to send email' }), { status: 500 });
    }
}

/**
 * API Route - Handle GET requests
 */
export async function GET() {
    // Set CORS headers to allow all origins
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };

    // Return response for GET request
    return new Response(JSON.stringify({ message: 'Hello from GET!' }), { status: 200, headers });
}
