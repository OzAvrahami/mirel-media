# הקמת mirel-media במחשב שלך

הפרויקט כולל את העיצוב שאישרת, תיקוני אנגלית, שרת Node וטופס עם שליחת מייל דרך Resend. ריפו GitHub ופרויקט Railway עדיין לא נוצרו.

## 1. הורדה וחילוץ

הורד את `mirel-media.zip`. ב־PowerShell חלץ אותו לתיקייה חדשה:

```powershell
Expand-Archive "$env:USERPROFILE\Downloads\mirel-media.zip" -DestinationPath "D:\code"
Set-Location "D:\code\mirel-media"
```

אם קיימת כבר תיקייה בשם הזה, עצור ובחר יעד אחר. אל תחלץ מעל פרויקט קיים.

## 2. יצירת ריפו פרטי

נדרשים Git ו־GitHub CLI מחובר לחשבון OzAvrahami:

```powershell
git init -b main
git add .
git commit -m "Initial mirel-media website and contact API"
gh repo create OzAvrahami/mirel-media --private --source=. --remote=origin --push
```

אם GitHub CLI אינו מחובר, הרץ קודם `gh auth login`. אם הפקודה נכשלת, אל תמחק או תחליף ריפו קיים.

## 3. הפעלה מקומית

נדרש Node.js 24 ומעלה. אין חבילות להתקין.

```powershell
Copy-Item .env.example .env
npm run dev
```

פתח `http://localhost:3000`. הטופס לא יציג הצלחה ולא ישלח עד שפרטי המייל יוגדרו.

## 4. חיבור מייל

בקובץ `.env` יש להגדיר `RESEND_API_KEY`, כתובת שולח מאומתת ב־`CONTACT_FROM`, וכתובת יעד ב־`CONTACT_TO`. אפשר להשתמש בפורמט `mirel-media <forms@your-domain.com>` לשולח. אלו דוגמאות בלבד; אין בפרויקט כתובת יעד אמיתית.

אל תשלח מפתח API בצ׳אט ואל תעלה אותו לריפו. קובץ `.env` כבר מוחרג מ־Git. להפעלה ב־Railway מגדירים את הערכים ב־Variables, יחד עם `NODE_ENV=production` ו־`PUBLIC_ORIGIN` שהוא כתובת האתר המלאה ב־HTTPS ללא נתיב.

לאחר ההגדרה צריך להפעיל מחדש ולוודא שפנייה אמיתית מגיעה לתיבה הנכונה. מדריך מפורט נמצא ב־`docs/LAUNCH.md`.

## מה נבדק

13 בדיקות שרת עברו, עם ספק מייל מדומה וללא שליחת הודעות. בדיקות קוד, קישורים וקבצים עברו. בדיקת דפדפן ויזואלית ומסירת מייל אמיתי עדיין לא בוצעו.
