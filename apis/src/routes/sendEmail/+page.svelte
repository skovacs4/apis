<script>
// In your +page.svelte or another component
async function sendEmail(data) {
    try {
        const response = await fetch('/sendEmail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data) 
        });

        if (response.ok) {
            console.log('Email sent successfully!');
        } else {
            console.error('Email sending failed:', await response.json());
        }
    } catch (error) {
        console.error('Error:', error); 
    }
}
</script>

<h1>Send email api</h1>
<p>It only takes POST requests.</p>

