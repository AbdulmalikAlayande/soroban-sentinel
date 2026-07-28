const target = {
    foo: () => "bar",
    value: 42
};

const proxy = new Proxy({}, {
    get: (_, prop) => {
        const val = (target as any)[prop];
        if (typeof val === "function") {
            return (...args: any[]) => {
                console.log(`Called ${String(prop)}`);
                return val.apply(target, args);
            };
        }
        return val;
    }
});

console.log((proxy as any).foo());
console.log((proxy as any).value);
console.log(typeof (proxy as any).missing);
