module.exports = {
    sleep: (delay) => {
        return new Promise(resolve => {
            setTimeout(() => resolve(), delay);
        });
    }
};
