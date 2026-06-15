

## How can I edit this code?

There are several ways of editing your application.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## Vercel Serverless Setup

Firebase Cloud Functions are not used for analytics in this app. The analytics endpoint is a Vercel Function at:

```txt
/api/analysis-summary
```

Set these environment variables in Vercel:

```txt
FIREBASE_SERVICE_ACCOUNT_KEY=<full Firebase service account JSON>
FIREBASE_DATABASE_URL=<Realtime Database URL>
FIREBASE_AUTH_PROJECT_ID=<Firebase Auth project id>
SITE_ORIGIN=https://gencofarm.com
```

For local Vercel Function testing:

```sh
npm run dev:vercel
```

The React app calls `/api/analysis-summary`; it should not call Firebase Cloud Functions.
