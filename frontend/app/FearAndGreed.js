// functions/fear-greed-request.js

const dataSource = {
    url: "https://api.alternative.me/fng/",
    parse: (data) => {
        if (!data?.data || !Array.isArray(data.data) || !data.data[0]?.value) {
            throw new Error("Invalid structure in Fear & Greed API response");
        }
        return {
            value: data.data[0].value,
            classification: data.data[0].value_classification
        };
    }
};

try {
    const response = await Functions.makeHttpRequest({
        url: dataSource.url,
        timeout: 9000
    });

    if (!response?.data) {
        throw new Error(`No data received from ${dataSource.url}`);
    }

    const parsed = dataSource.parse(response.data);

    return Functions.encodeString(JSON.stringify({
        timestamp: Math.floor(Date.now() / 1000),
        fear_greed: parsed
    }));

} catch (error) {
    return Functions.encodeString(JSON.stringify({
        timestamp: Math.floor(Date.now() / 1000),
        error: error.message
    }));
}
