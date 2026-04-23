const { HDate } = require('@hebcal/core');

function getOmerMessage() {
    // Sefirat HaOmer is counted at night. So the day we are counting "tonight"
    // actually belongs to the Jewish date of the next Gregorian day.
    // We add 12 hours to the current time to ensure we are calculating for 
    // the Jewish day that starts this evening.
    const now = new Date();
    const tonight = new Date(now.getTime() + 12 * 60 * 60 * 1000);
    const hdate = new HDate(tonight);
    
    const month = hdate.getMonth();
    const day = hdate.getDate();
    
    let omerDay = 0;
    if (month === 1 && day >= 16) omerDay = day - 15;
    else if (month === 2) omerDay = 15 + day;
    else if (month === 3 && day <= 5) omerDay = 44 + day;

    // omerDay is 0 if it's not during Sefirat HaOmer
    if (omerDay === 0) {
        return null;
    }

    const weeks = Math.floor(omerDay / 7);
    const days = omerDay % 7;

    const hebrewNumbers = [
        '', 'אֶחָד', 'שְׁנֵי', 'שְׁלוֹשָׁה', 'אַרְבָּעָה', 'חֲמִשָּׁה', 'שִׁשָּׁה', 'שִׁבְעָה', 'שְׁמוֹנָה', 'תִּשְׁעָה', 'עֲשָׂרָה',
        'אַחַד עָשָׂר', 'שְׁנֵים עָשָׂר', 'שְׁלוֹשָׁה עָשָׂר', 'אַרְבָּעָה עָשָׂר', 'חֲמִשָּׁה עָשָׂר', 'שִׁשָּׁה עָשָׂר', 'שִׁבְעָה עָשָׂר', 'שְׁמוֹנָה עָשָׂר', 'תִּשְׁעָה עָשָׂר', 'עֶשְׂרִים',
        'אֶחָד וְעֶשְׂרִים', 'שְׁנַיִם וְעֶשְׂרִים', 'שְׁלוֹשָׁה וְעֶשְׂרִים', 'אַרְבָּעָה וְעֶשְׂרִים', 'חֲמִשָּׁה וְעֶשְׂרִים', 'שִׁשָּׁה וְעֶשְׂרִים', 'שִׁבְעָה וְעֶשְׂרִים', 'שְׁמוֹנָה וְעֶשְׂרִים', 'תִּשְׁעָה וְעֶשְׂרִים', 'שְׁלוֹשִׁים',
        'אֶחָד וּשְׁלוֹשִׁים', 'שְׁנַיִם וּשְׁלוֹשִׁים', 'שְׁלוֹשָׁה וּשְׁלוֹשִׁים', 'אַרְבָּעָה וּשְׁלוֹשִׁים', 'חֲמִשָּׁה וּשְׁלוֹשִׁים', 'שִׁשָּׁה וּשְׁלוֹשִׁים', 'שִׁבְעָה וּשְׁלוֹשִׁים', 'שְׁמוֹנָה וּשְׁלוֹשִׁים', 'תִּשְׁעָה וּשְׁלוֹשִׁים', 'אַרְבָּעִים',
        'אֶחָד וְאַרְבָּעִים', 'שְׁנַיִם וְאַרְבָּעִים', 'שְׁלוֹשָׁה וְאַרְבָּעִים', 'אַרְבָּעָה וְאַרְבָּעִים', 'חֲמִשָּׁה וְאַרְבָּעִים', 'שִׁשָּׁה וְאַרְבָּעִים', 'שִׁבְעָה וְאַרְבָּעִים', 'שְׁמוֹנָה וְאַרְבָּעִים', 'תִּשְׁעָה וְאַרְבָּעִים'
    ];

    const extraDaysMap = {
        1: 'וְיוֹם אֶחָד',
        2: 'וּשְׁנֵי יָמִים',
        3: 'וּשְׁלוֹשָׁה יָמִים',
        4: 'וְאַרְבָּעָה יָמִים',
        5: 'וַחֲמִשָּׁה יָמִים',
        6: 'וְשִׁשָּׁה יָמִים'
    };

    // Both English and Hebrew format
    let hebrewMessage = omerDay === 1 
        ? `הַיּוֹם יוֹם אֶחָד לָעוֹמֶר` 
        : `הַיּוֹם ${hebrewNumbers[omerDay]} יָמִים לָעוֹמֶר`;
        
    let englishMessage = `Today is day ${omerDay} of the Omer.`;

    if (weeks > 0) {
        if (weeks === 1) hebrewMessage += ` שֶׁהֵם שָׁבוּעַ אֶחָד`;
        else hebrewMessage += ` שֶׁהֵם ${hebrewNumbers[weeks]} שָׁבוּעוֹת`;
        
        englishMessage += ` (which is ${weeks} week${weeks > 1 ? 's' : ''}`;
        
        if (days > 0) {
            hebrewMessage += ` ${extraDaysMap[days]}`;
            englishMessage += ` and ${days} day${days > 1 ? 's' : ''}`;
        }
        englishMessage += ')';
    }

    return `${hebrewMessage}\n🌾🌾🌾\n\n${englishMessage}`;
}

module.exports = { getOmerMessage };
