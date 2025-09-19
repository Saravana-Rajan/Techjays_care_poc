const getCSRFToken = () => {
    return document.querySelector('[name=csrfmiddlewaretoken]')?.value || 
           document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ||
           getCookie('csrftoken');
};

// Helper function to get cookie by name
const getCookie = (name) => {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
};

// Function to validate user responses and filter out noise
const isValidUserResponse = (text) => {
    if (!text || text.length < 3) return false;
    
    // List of filler words and noise to ignore
    const noiseWords = new Set([
        'um', 'uh', 'yeah', 'okay', 'sure', 'right', 'hmm', 'ah', 'oh', 'well',
        'like', 'you know', 'i mean', 'basically', 'actually', 'literally',
        'sort of', 'kind of', 'more or less', 'pretty much'
    ]);

    const lowerText = text.toLowerCase().trim();
    
    // Check if response is just noise words
    const words = lowerText.split(/\s+/);
    const meaningfulWords = words.filter(word => !noiseWords.includes(word));
    
    // If less than 2 meaningful words, consider it noise
    if (meaningfulWords.length < 2) return false;
    
    // Check if response is too short or just repeated words
    if (lowerText.length < 5) return false;
    
    // Check for repeated characters (like "ummmmm")
    if (/(.)\1{3,}/.test(lowerText)) return false;
    
    return true;
};

const checkAdult = (dob) => {
    try {
    const today = new Date();
        const birthDate = new Date(dob);
        let age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
        return age >= 16;
    } catch (error) {
        return false;
    }
}

export { getCSRFToken, getCookie, isValidUserResponse, checkAdult };
