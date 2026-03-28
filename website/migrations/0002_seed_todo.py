from django.db import migrations

SECTIONS = [
    {
        "title": "High Priority",
        "items": [
            ("To-do list feature on the site itself", False),
            ("Rework UI/UX layout and styling (careful, intentional design)", False),
            (
                "RPG/Terraria-style townhall map as main landing page — pixel art buildings representing each section",
                False,
            ),
            ("Website favicon/logo for browser tab (cat head)", True),
            ("Internationalization with next-intl (Vietnamese, English, French, German)", False),
        ],
    },
    {
        "title": "Content",
        "items": [
            ("Fill in CV (experience, education)", False),
            ("Write first real blog post", False),
            ("Upload more gallery images (cats, fish, trees)", False),
            ("Image upload feature — web UI to upload from phone browser (no Termux needed)", False),
            ("Blog topics: geopolitics, finance, macro economics, history", False),
            ("TIL (Today I Learned) section — short technical notes", False),
            ("YouTube playlists page — embed/link favorite videos", False),
            ("Music page — favorite tracks/playlists (Spotify/YouTube embed integration)", False),
            ('Food section — cookbook, recipes, recommendations, "what to eat tonight" randomizer', False),
        ],
    },
    {
        "title": "Health & Fitness",
        "items": [
            ("Run tracker — distance, routes shown on map", False),
            ("Gym log — pull-ups, exercises, progress tracking", False),
            ("Health diary — sickness, symptoms, history", False),
            ("AI health chatbot — ask agent about symptoms (with disclaimers)", False),
        ],
    },
    {
        "title": "News & Briefing",
        "items": [
            ("AI news crawler agent — auto-fetch and summarize news", False),
            ("Daily briefing page — Bloomberg-style but broader (geopolitics, tech, finance, culture)", False),
            ("Source aggregation — RSS feeds, news APIs, social media", False),
            ("Set up Instagram and X/Twitter accounts for content sourcing", False),
            ("Custom feed — filter by topic, region, relevance", False),
        ],
    },
    {
        "title": "Financial",
        "items": [
            ("Portfolio tracker — stocks, ETFs, crypto", False),
            ("Bank data import — N26, Revolut, Trade Republic integration", False),
            ("Spending analysis & visualization", False),
            ("Privacy/security considerations — encryption, auth, no plaintext storage", False),
        ],
    },
    {
        "title": "Minecraft",
        "items": [
            ("Minecraft section — server link (play.thirdplace.net), screenshots of builds", False),
            ("Build showcase gallery", False),
        ],
    },
    {
        "title": "Projects",
        "items": [
            ("Set up subdomain pattern for project demos (e.g. klaude.nam685.de)", False),
            ("DIY Klaude Code demo", False),
            ("Vibe Code via Phone writeup", False),
            ("Ellamind product suite integration (TBD ~June 2026)", False),
        ],
    },
    {
        "title": "Design",
        "items": [
            ("Discover Stitch (Figma killer) — explore for UI/UX design without being a pro designer", True),
            ("Define color palette and design system", True),
            ("Typography choices", False),
            ("Consistent spacing/sizing tokens", False),
            ("Light/dark mode (auto, follows system preference)", True),
            ("Pixel art assets for RPG landing page", False),
        ],
    },
    {
        "title": "Personal Pages",
        "items": [
            ("/now — what I'm currently doing/reading/playing", True),
            ("/uses — hardware, software, tools, dotfiles", True),
            ("Digital garden — interconnected wiki-style notes", False),
            ("Reading list — books read, rating, notes", False),
            ("Bookmarks — saved links with tags", False),
            ("Changelog — public site changelog", True),
            ("RSS feed for blog (/feed.xml)", True),
        ],
    },
    {
        "title": "Social",
        "items": [
            ("Guestbook — visitors leave messages", False),
            ("Blogroll — links to sites/blogs I follow", False),
            ("Webring — link exchange with friends", False),
            ("Wishlist", False),
            ("Webmentions — decentralized comments from other sites", False),
            ("ActivityPub / Fediverse integration", False),
            ("Email newsletter — subscribe form", False),
        ],
    },
    {
        "title": "Admin / Auth",
        "items": [
            ("Authentication system (login, session management)", False),
            ("Admin dashboard — content management, image upload, post editor", False),
            ("Role-based access (public vs private content)", False),
            (
                "Public/private content separation — private diary, health data, finances behind auth; blog, gallery, projects public",
                False,
            ),
            ("OAuth / social login (optional)", False),
        ],
    },
    {
        "title": "Infrastructure",
        "items": [
            ("Set up GitHub Actions deploy SSH key secret", False),
            ("Start PostgreSQL + Redis via Docker Compose", False),
            ("Deploy Django backend", False),
            ("Upgrade Node.js to 20+ (fixes Tailwind v4 ARM64 support)", False),
            ("Dependabot for auto dependency updates", True),
            ("Uptime monitoring / health check cron", False),
        ],
    },
]


def seed_todo(apps, _schema_editor):
    TodoSection = apps.get_model("website", "TodoSection")
    TodoItem = apps.get_model("website", "TodoItem")
    for section_order, section_data in enumerate(SECTIONS):
        section = TodoSection.objects.create(title=section_data["title"], order=section_order)
        for item_order, (text, done) in enumerate(section_data["items"]):
            TodoItem.objects.create(section=section, text=text, done=done, order=item_order)


def unseed_todo(apps, _schema_editor):
    apps.get_model("website", "TodoSection").objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ("website", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_todo, unseed_todo),
    ]
