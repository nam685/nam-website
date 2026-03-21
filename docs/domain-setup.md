# Domain Setup

## Choosing a Domain

Suggested: **namle.dev** or **nam.dev** (check availability)

| TLD   | ~Cost/yr | Notes                                      |
|-------|----------|--------------------------------------------|
| .dev  | $12-14   | Forces HTTPS, professional, dev-oriented   |
| .me   | $10-15   | Good for personal branding                 |
| .page | $12      | Clean, forces HTTPS, underused             |
| .xyz  | $10-12   | Cheap but sometimes spammy reputation      |
| .sh   | $20-30   | Cool for dev, pricier                      |
| .io   | $30-40   | Popular but overpriced, geopolitical risk   |

## Recommended Registrars

### Porkbun (recommended for this project)
- Cheapest prices, clean UI, free SSL/DNS/email forwarding
- https://porkbun.com

### Cloudflare Registrar
- At-cost pricing (no markup), integrated CDN/DNS
- https://dash.cloudflare.com

### Namecheap
- Wide TLD selection, free WhoisGuard
- https://namecheap.com

## How to Buy a Domain (Porkbun example)

1. Go to https://porkbun.com
2. Search for your desired domain (e.g. `namle.dev`)
3. Add to cart, create account, pay (~$12/yr for .dev)
4. After purchase, go to domain management

## After Purchase: DNS Setup

### Option A: Use Hetzner DNS (free)
1. Go to https://dns.hetzner.com
2. Add your domain as a new zone
3. At Porkbun, change nameservers to Hetzner's:
   - `hydrogen.ns.hetzner.com`
   - `oxygen.ns.hetzner.com`
   - `helium.ns.hetzner.de`
4. In Hetzner DNS, add an A record:
   - **Name:** `@` (root) or subdomain like `home`
   - **Type:** A
   - **Value:** 204.168.159.7

### Option B: Use Porkbun's DNS (simpler)
1. In Porkbun domain management, go to DNS records
2. Add A record:
   - **Host:** (blank for root, or `home` for subdomain)
   - **Type:** A
   - **Answer:** 204.168.159.7
3. Wait for propagation (~5-30 min)

## HTTPS Setup with Caddy

Once DNS is pointing to the server:

```bash
sudo apt install -y caddy
```

Edit `/etc/caddy/Caddyfile`:
```
yourdomain.dev {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl enable --now caddy
```

Caddy auto-provisions Let's Encrypt HTTPS certificates. No manual cert management needed.

## TODO

- [ ] Choose and purchase domain
- [ ] Configure DNS (A record → 204.168.159.7)
- [ ] Install Caddy and configure reverse proxy
- [ ] Daemonize Next.js with systemd or PM2
