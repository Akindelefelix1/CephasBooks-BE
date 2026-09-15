interface AuthEmailDetails {
  firstName: string;
  organizationName: string;
  appUrl: string;
}

export function verificationEmailTemplate(details: AuthEmailDetails & { code: string }): string {
  const firstName = escapeHtml(details.firstName || 'there');
  const organizationName = escapeHtml(details.organizationName || 'your organisation');
  const code = escapeHtml(details.code);
  return emailLayout({
    preheader: `Your Cephas Books verification code is ${code}`,
    eyebrow: 'WELCOME TO CEPHAS BOOKS',
    title: `Let’s secure your account, ${firstName}.`,
    body: `Your workspace for <strong>${organizationName}</strong> has been created. Verify your email address to activate the account and continue setting up your financial workspace.`,
    content: `
      <div style="margin:28px 0;padding:24px;border:1px solid #dbe4ff;border-radius:16px;background:#f5f8ff;text-align:center">
        <div style="margin-bottom:10px;color:#66728a;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Your verification code</div>
        <div style="color:#102a8f;font-size:34px;font-weight:800;letter-spacing:10px;line-height:1.2">${code}</div>
        <div style="margin-top:12px;color:#66728a;font-size:13px">This code expires in 10 minutes.</div>
      </div>
      <p style="margin:0;color:#66728a;font-size:14px;line-height:1.65">For your security, never share this code with anyone. Cephas Books will never ask for it by phone or chat.</p>`,
  });
}

export function accountVerifiedEmailTemplate(details: AuthEmailDetails): string {
  const firstName = escapeHtml(details.firstName || 'there');
  const organizationName = escapeHtml(details.organizationName || 'your organisation');
  const appUrl = escapeHtml(details.appUrl);
  return emailLayout({
    preheader: 'Your Cephas Books account is verified and ready.',
    eyebrow: 'EMAIL VERIFIED',
    title: `You’re all set, ${firstName}.`,
    body: `Your email has been verified successfully and <strong>${organizationName}</strong> is ready for setup. You can now continue configuring your financial settings, tax profile, organisation structure, and team.`,
    content: `
      <div style="margin:28px 0;text-align:center">
        <a href="${appUrl}" style="display:inline-block;padding:14px 24px;border-radius:10px;background:#173bd1;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none">Continue to your workspace →</a>
      </div>
      <div style="padding:18px 20px;border-radius:14px;background:#eefbf7;color:#235b4b;font-size:14px;line-height:1.6">
        <strong style="display:block;margin-bottom:4px;color:#124637">Account protected</strong>
        Your verified email is now connected to your Cephas Books workspace.
      </div>`,
  });
}

function emailLayout(input: {
  preheader: string;
  eyebrow: string;
  title: string;
  body: string;
  content: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#f2f5fb;font-family:Inter,Arial,sans-serif;color:#111a31">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${input.preheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f5fb;padding:32px 12px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;overflow:hidden;border:1px solid #e2e7f2;border-radius:20px;background:#ffffff;box-shadow:0 14px 40px rgba(17,42,112,.10)">
          <tr><td style="height:7px;background:linear-gradient(90deg,#173bd1,#00baff)"></td></tr>
          <tr><td style="padding:32px 38px 12px">
            <div style="margin-bottom:34px;font-size:20px;font-weight:800"><span style="color:#00aeea">▰</span> Cephas <span style="color:#173bd1">Books</span></div>
            <div style="margin-bottom:10px;color:#173bd1;font-size:12px;font-weight:800;letter-spacing:.12em">${input.eyebrow}</div>
            <h1 style="margin:0 0 14px;color:#0b1530;font-size:30px;line-height:1.2;letter-spacing:-.02em">${input.title}</h1>
            <p style="margin:0;color:#59667f;font-size:16px;line-height:1.7">${input.body}</p>
            ${input.content}
          </td></tr>
          <tr><td style="padding:22px 38px;border-top:1px solid #edf0f6;background:#fafbfe;color:#7b8498;font-size:12px;line-height:1.6">
            This is an automated security email from Cephas Books. If you did not create this account, you can safely ignore this message.<br>
            © ${new Date().getUTCFullYear()} Cephas Books. Secure financial management for growing businesses.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };
    return entities[character] ?? character;
  });
}
